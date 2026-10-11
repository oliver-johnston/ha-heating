from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiohttp

from .config import NotificationSettings

log = logging.getLogger(__name__)


class NotificationDeliveryError(RuntimeError):
    pass


@dataclass(frozen=True)
class NotificationIssue:
    key: str
    title: str
    detail: str
    severity: str


class DiscordNotifier:
    """Reliable, stateful Discord delivery without coupling heating safety to Discord."""

    def __init__(
        self,
        session: aiohttp.ClientSession | None,
        state_path: str | Path,
        *,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.session = session
        self.state_path = Path(state_path)
        self._sleep = sleep
        self._state = self._load()

    async def send_test(self, settings: NotificationSettings) -> None:
        await self._post(
            settings,
            "Heat Steward test notification",
            "Discord notifications are configured correctly.",
            "info",
        )

    async def notify_fault(
        self,
        settings: NotificationSettings,
        reason: str,
        *,
        paused: bool = True,
    ) -> bool:
        if not settings.enabled or not settings.discord_webhook_url:
            return False
        state_key = "safety_stop" if paused else "control_problem"
        current = self._state.get(state_key)
        if isinstance(current, dict) and current.get("sent"):
            return True
        title = "Heat Steward safety stop" if paused else "Heat Steward control problem"
        description = (
            "Automatic heating is paused until this safety stop is acknowledged.\n\n"
            if paused
            else "Automatic heating remains enabled and will keep retrying.\n\n"
        )
        delivered = await self._safe_post(
            settings,
            title,
            description + reason,
            "critical",
        )
        if delivered:
            self._state[state_key] = {
                "sent": True,
                "title": title,
                "detail": reason,
                "severity": "critical",
                "paused": paused,
                "first_seen_at": datetime.now(UTC).isoformat(),
            }
            self._safe_save()
        return delivered

    async def resolve_fault(
        self,
        settings: NotificationSettings,
        *,
        paused: bool = True,
    ) -> None:
        state_key = "safety_stop" if paused else "control_problem"
        existing = self._state.get(state_key)
        if not isinstance(existing, dict):
            return
        if settings.enabled and settings.send_recovery and settings.discord_webhook_url:
            recovery = (
                "The safety stop was acknowledged. Automatic control will resume."
                if existing.get("paused")
                else "The control problem cleared. Automatic control remained enabled."
            )
            delivered = await self._safe_post(
                settings,
                "Heat Steward recovered",
                recovery,
                "recovery",
            )
            if not delivered:
                return
        self._state.pop(state_key, None)
        self._safe_save()

    def reset(self) -> None:
        self._state.clear()
        self._safe_save()

    async def reconcile(
        self,
        settings: NotificationSettings,
        issues: list[NotificationIssue],
        *,
        at: datetime | None = None,
    ) -> None:
        if not settings.enabled or not settings.discord_webhook_url:
            return
        now = at or datetime.now(UTC)
        if now.tzinfo is None:
            now = now.replace(tzinfo=UTC)
        eligible = {
            issue.key: issue
            for issue in issues
            if issue.severity == "critical" or settings.level == "warning"
        }
        ready: list[NotificationIssue] = []

        for key, issue in eligible.items():
            existing = self._state.get(key)
            if not isinstance(existing, dict):
                existing = {
                    "first_seen_at": now.isoformat(),
                    "sent": False,
                }
                self._state[key] = existing
            existing.update(
                {
                    "title": issue.title,
                    "detail": issue.detail,
                    "severity": issue.severity,
                }
            )
            if existing.get("sent"):
                continue
            try:
                first_seen = datetime.fromisoformat(str(existing["first_seen_at"]))
            except (KeyError, TypeError, ValueError):
                first_seen = now
                existing["first_seen_at"] = now.isoformat()
            delay = 0 if issue.severity == "critical" else settings.warning_delay_seconds
            if (now - first_seen.astimezone(now.tzinfo)).total_seconds() >= delay:
                ready.append(issue)

        if ready:
            severity = (
                "critical" if any(issue.severity == "critical" for issue in ready) else "warning"
            )
            title = "Heat Steward needs attention"
            description = "\n".join(f"**{issue.title}**\n{issue.detail}" for issue in ready)
            if await self._safe_post(settings, title, description, severity):
                for issue in ready:
                    self._state[issue.key]["sent"] = True

        recoveries = [
            (key, value)
            for key, value in self._state.items()
            if key not in {"safety_fault", "safety_stop", "control_problem"}
            and key not in eligible
            and isinstance(value, dict)
        ]
        sent_recoveries = [(key, value) for key, value in recoveries if value.get("sent")]
        remove_recoveries = not sent_recoveries or not settings.send_recovery
        if sent_recoveries and settings.send_recovery:
            description = "\n".join(
                f"**{value.get('title', 'Issue')}** is back to normal."
                for _, value in sent_recoveries
            )
            remove_recoveries = await self._safe_post(
                settings,
                "Heat Steward recovered",
                description,
                "recovery",
            )
        if remove_recoveries:
            for key, _ in recoveries:
                self._state.pop(key, None)

        self._safe_save()

    async def _safe_post(
        self,
        settings: NotificationSettings,
        title: str,
        description: str,
        severity: str,
    ) -> bool:
        try:
            await self._post(settings, title, description, severity)
            return True
        except NotificationDeliveryError as exc:
            log.warning("Could not deliver Discord notification: %s", exc)
            return False
        except Exception as exc:
            log.warning("Unexpected Discord notification failure (%s)", type(exc).__name__)
            return False

    async def _post(
        self,
        settings: NotificationSettings,
        title: str,
        description: str,
        severity: str,
    ) -> None:
        if not settings.discord_webhook_url:
            raise NotificationDeliveryError("No Discord webhook is configured")
        if self.session is None:
            raise NotificationDeliveryError("The Discord HTTP client is unavailable")
        colors = {
            "critical": 0xBA1A1A,
            "warning": 0xE5A000,
            "recovery": 0x2E7D32,
            "info": 0x6750A4,
        }
        payload = {
            "username": "Heat Steward",
            "allowed_mentions": {"parse": []},
            "embeds": [
                {
                    "title": title[:256],
                    "description": description[:4096],
                    "color": colors.get(severity, colors["info"]),
                    "timestamp": datetime.now(UTC).isoformat(),
                    "footer": {"text": "Heat Steward add-on"},
                }
            ],
        }
        error = "Discord rejected the notification"
        for attempt in range(3):
            try:
                async with self.session.post(
                    settings.discord_webhook_url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    if response.status in {200, 204}:
                        return
                    error = f"Discord returned HTTP {response.status}"
            except (aiohttp.ClientError, TimeoutError, RuntimeError) as exc:
                error = f"Discord could not be reached ({type(exc).__name__})"
            if attempt < 2:
                await self._sleep(0.5 * (2**attempt))
        raise NotificationDeliveryError(error)

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self.state_path.exists():
            return {}
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(value, dict):
            return {}
        return {key: item for key, item in value.items() if isinstance(item, dict)}

    def _save(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary_path = tempfile.mkstemp(
            prefix=f".{self.state_path.name}.", suffix=".tmp", dir=self.state_path.parent
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(self._state, handle, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary_path, 0o600)
            os.replace(temporary_path, self.state_path)
        except Exception:
            with suppress(FileNotFoundError):
                os.unlink(temporary_path)
            raise

    def _safe_save(self) -> None:
        try:
            self._save()
        except OSError as exc:
            log.warning("Could not persist Discord notification state: %s", exc)
