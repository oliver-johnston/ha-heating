from __future__ import annotations

from datetime import UTC, datetime, timedelta

from heat_steward.config import NotificationSettings
from heat_steward.notifications import DiscordNotifier, NotificationIssue


class FakeResponse:
    def __init__(self, status: int = 204):
        self.status = status

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class FakeSession:
    def __init__(self, statuses=None):
        self.posts = []
        self.statuses = list(statuses or [204])

    def post(self, url, *, json, timeout):
        self.posts.append({"url": url, "json": json, "timeout": timeout})
        status = self.statuses.pop(0) if self.statuses else 204
        return FakeResponse(status)


async def test_warning_is_delayed_deduplicated_and_recovers_across_restarts(tmp_path):
    session = FakeSession()
    state_path = tmp_path / "notification-state.json"
    settings = NotificationSettings(
        enabled=True,
        discord_webhook_url="https://discord.com/api/webhooks/123456/secret-token",
        level="warning",
        send_recovery=True,
        warning_delay_seconds=60,
    )
    issue = NotificationIssue(
        key="room:kitchen:fallback",
        title="Kitchen is using its fallback sensor",
        detail="The external sensor is stale.",
        severity="warning",
    )
    started = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
    notifier = DiscordNotifier(session, state_path)

    await notifier.reconcile(settings, [issue], at=started)
    assert session.posts == []

    await notifier.reconcile(settings, [issue], at=started + timedelta(seconds=61))
    assert len(session.posts) == 1
    assert "Kitchen" in session.posts[0]["json"]["embeds"][0]["description"]

    restarted = DiscordNotifier(session, state_path)
    await restarted.reconcile(settings, [issue], at=started + timedelta(minutes=5))
    assert len(session.posts) == 1

    await restarted.reconcile(settings, [], at=started + timedelta(minutes=6))
    assert len(session.posts) == 2
    assert session.posts[1]["json"]["embeds"][0]["title"] == "Heat Steward recovered"


async def test_critical_issue_is_sent_immediately(tmp_path):
    session = FakeSession()
    settings = NotificationSettings(
        enabled=True,
        discord_webhook_url="https://discord.com/api/webhooks/123456/secret-token",
    )
    notifier = DiscordNotifier(session, tmp_path / "notification-state.json")

    await notifier.reconcile(
        settings,
        [
            NotificationIssue(
                key="relay:central-heating:unavailable",
                title="Central-heating relay is unavailable",
                detail="Home Assistant cannot read the relay.",
                severity="critical",
            )
        ],
        at=datetime(2026, 10, 10, 12, 0, tzinfo=UTC),
    )

    assert len(session.posts) == 1
    embed = session.posts[0]["json"]["embeds"][0]
    assert embed["title"] == "Heat Steward needs attention"
    assert embed["color"] == 0xBA1A1A


async def test_delayed_critical_issue_drops_transient_without_recovery(tmp_path):
    session = FakeSession()
    settings = NotificationSettings(
        enabled=True,
        discord_webhook_url="https://discord.com/api/webhooks/123456/secret-token",
        send_recovery=True,
    )
    notifier = DiscordNotifier(session, tmp_path / "notification-state.json")
    started = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
    issue = NotificationIssue(
        key="relay:central-heating:unavailable",
        title="Central-heating relay is unavailable",
        detail="Home Assistant cannot read the relay.",
        severity="critical",
        notification_delay_seconds=90,
    )

    await notifier.reconcile(settings, [issue], at=started)
    await notifier.reconcile(settings, [], at=started + timedelta(seconds=30))

    assert session.posts == []


async def test_delayed_critical_issue_sends_after_delay_then_recovers(tmp_path):
    session = FakeSession()
    settings = NotificationSettings(
        enabled=True,
        discord_webhook_url="https://discord.com/api/webhooks/123456/secret-token",
        send_recovery=True,
    )
    notifier = DiscordNotifier(session, tmp_path / "notification-state.json")
    started = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)
    issue = NotificationIssue(
        key="relay:central-heating:unavailable",
        title="Central-heating relay is unavailable",
        detail="Home Assistant cannot read the relay.",
        severity="critical",
        notification_delay_seconds=90,
    )

    await notifier.reconcile(settings, [issue], at=started)
    await notifier.reconcile(settings, [issue], at=started + timedelta(seconds=89))
    assert session.posts == []

    await notifier.reconcile(settings, [issue], at=started + timedelta(seconds=90))
    assert len(session.posts) == 1
    assert session.posts[0]["json"]["embeds"][0]["color"] == 0xBA1A1A

    await notifier.reconcile(settings, [], at=started + timedelta(seconds=91))
    assert len(session.posts) == 2
    assert session.posts[1]["json"]["embeds"][0]["title"] == "Heat Steward recovered"


async def test_fault_notification_is_deduplicated_and_resolved(tmp_path):
    session = FakeSession()
    settings = NotificationSettings(
        enabled=True,
        discord_webhook_url="https://discord.com/api/webhooks/123456/secret-token",
    )
    state_path = tmp_path / "notification-state.json"
    notifier = DiscordNotifier(session, state_path)

    assert await notifier.notify_fault(settings, "A relay command failed") is True
    assert (
        await DiscordNotifier(session, state_path).notify_fault(settings, "A relay command failed")
        is True
    )
    assert len(session.posts) == 1

    await DiscordNotifier(session, state_path).resolve_fault(settings)
    assert len(session.posts) == 2
    assert session.posts[-1]["json"]["embeds"][0]["title"] == "Heat Steward recovered"


async def test_recoverable_control_problem_says_automatic_control_keeps_running(tmp_path):
    session = FakeSession()
    settings = NotificationSettings(
        enabled=True,
        discord_webhook_url="https://discord.com/api/webhooks/123456/secret-token",
    )
    state_path = tmp_path / "notification-state.json"
    notifier = DiscordNotifier(session, state_path)

    assert (
        await notifier.notify_fault(
            settings,
            "The heating relay command was not confirmed",
            paused=False,
        )
        is True
    )
    problem = session.posts[-1]["json"]["embeds"][0]
    assert problem["title"] == "Heat Steward control problem"
    assert "remains enabled" in problem["description"]
    assert "keep retrying" in problem["description"]

    await DiscordNotifier(session, state_path).resolve_fault(settings, paused=False)
    recovery = session.posts[-1]["json"]["embeds"][0]
    assert recovery["title"] == "Heat Steward recovered"
    assert "remained enabled" in recovery["description"]


async def test_delivery_retries_temporary_discord_failures(tmp_path):
    session = FakeSession([500, 502, 204])
    waits = []

    async def fake_sleep(seconds):
        waits.append(seconds)

    settings = NotificationSettings(
        enabled=True,
        discord_webhook_url="https://discord.com/api/webhooks/123456/secret-token",
    )
    notifier = DiscordNotifier(
        session,
        tmp_path / "notification-state.json",
        sleep=fake_sleep,
    )

    await notifier.send_test(settings)

    assert len(session.posts) == 3
    assert waits == [0.5, 1.0]
