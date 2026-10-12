from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .control_plan import ControlPlan


@dataclass(frozen=True)
class ControlEvent:
    occurred_at: datetime
    level: str
    message: str


@dataclass
class ControllerStatus:
    started_at: datetime = field(default_factory=lambda: datetime.now().astimezone())
    plan: ControlPlan | None = None
    last_cycle_started_at: datetime | None = None
    last_cycle_finished_at: datetime | None = None
    last_successful_cycle_at: datetime | None = None
    last_error: str | None = None
    waiting_for_readiness: bool = False
    fault_latched: bool = False
    fault_reason: str | None = None
    control_alert_reason: str | None = None
    consecutive_failures: int = 0
    notification_sent: bool = False
    loop_running: bool = False
    loop_restarts: int = 0
    actions: list[str] = field(default_factory=list)
    events: list[ControlEvent] = field(default_factory=list)
