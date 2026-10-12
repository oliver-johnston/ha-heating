import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import {
  MdFilledButton,
  MdOutlinedButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdSelectOption,
  MdSwitch,
  MdTextButton,
} from "../../material";
import { ControlSettingRow } from "../../components/HeatingCards";
import { CONFIGURED_WEBHOOK_VALUE } from "../../configForms";
import { eventSelected, eventValue } from "../../uiHelpers";
import type { NotificationValues } from "../../types";

type Props = {
  notifications: NotificationValues;
  setNotifications: Dispatch<SetStateAction<NotificationValues>>;
  discordWebhook: string;
  setDiscordWebhook: (value: string) => void;
  webhookConfigured: boolean;
  discordWebhookChanged: boolean;
  notificationSettingsValid: boolean;
  setupComplete: boolean;
  saving: boolean;
  testingNotifications: boolean;
  notice: string;
  visibleError: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onRemoveWebhook: () => void;
  onTestNotifications: () => void;
  onRevert: () => void;
  onDirty: () => void;
};

export function NotificationsSettingsPage({
  notifications,
  setNotifications,
  discordWebhook,
  setDiscordWebhook,
  webhookConfigured,
  discordWebhookChanged,
  notificationSettingsValid,
  setupComplete,
  saving,
  testingNotifications,
  notice,
  visibleError,
  onSubmit: saveNotifications,
  onRemoveWebhook,
  onTestNotifications,
  onRevert,
  onDirty,
}: Props) {
  return (
        <form onSubmit={saveNotifications}>
          <section className="section-heading">
            <div>
              <h2 className="md-typescale-headline-small">Notifications</h2>
              <p>Send important heating alerts directly to Discord.</p>
            </div>
          </section>

          <section className="settings-list notification-card">
            <div className="control-fields notification-settings">
              <ControlSettingRow
                title="Discord notifications"
                description="Send add-on alerts to Discord; Home Assistant safety notifications remain active."
              >
                <MdSwitch
                  aria-label="Discord notifications"
                  selected={notifications.enabled}
                  onChange={(event) => {
                    const enabled = eventSelected(event);
                    setNotifications((current) => ({
                      ...current,
                      enabled,
                    }));
                    onDirty();
                  }}
                />
              </ControlSettingRow>
              <ControlSettingRow
                title="Discord webhook"
                description="The channel destination; its secret URL is omitted from the UI and diagnostics."
              >
                <MdOutlinedTextField
                  label="Webhook URL"
                  type="password"
                  value={discordWebhook}
                  onFocus={() => {
                    if (discordWebhook === CONFIGURED_WEBHOOK_VALUE) setDiscordWebhook("");
                  }}
                  onBlur={() => {
                    if (!discordWebhook && webhookConfigured) {
                      setDiscordWebhook(CONFIGURED_WEBHOOK_VALUE);
                    }
                  }}
                  onInput={(event) => {
                    setDiscordWebhook(eventValue(event));
                    onDirty();
                  }}
                />
              </ControlSettingRow>
              <ControlSettingRow
                title="Notification level"
                description="Choose whether Discord receives critical faults only or warnings as well."
              >
                <MdOutlinedSelect
                  label="Level"
                  value={notifications.level}
                  onChange={(event) => {
                    const level = eventValue(event) as NotificationValues["level"];
                    setNotifications((current) => ({
                      ...current,
                      level,
                    }));
                    onDirty();
                  }}
                >
                  <MdSelectOption value="critical">Critical only</MdSelectOption>
                  <MdSelectOption value="warning">Critical and warnings</MdSelectOption>
                </MdOutlinedSelect>
              </ControlSettingRow>
              {notifications.level === "warning" && (
                <ControlSettingRow
                  title="Warning delay"
                  description="Wait before alerting so brief sensor or device dropouts do not send messages."
                >
                  <MdOutlinedTextField
                    required
                    label="Minutes"
                    type="number"
                    min="1"
                    max="1440"
                    step="1"
                    value={notifications.warning_delay_minutes}
                    onInput={(event) => {
                      const warningDelayMinutes = eventValue(event);
                      setNotifications((current) => ({
                        ...current,
                        warning_delay_minutes: warningDelayMinutes,
                      }));
                      onDirty();
                    }}
                  />
                </ControlSettingRow>
              )}
              <ControlSettingRow
                title="Recovery notifications"
                description="Send one message when a previously reported problem returns to normal."
              >
                <MdSwitch
                  aria-label="Recovery notifications"
                  selected={notifications.send_recovery}
                  onChange={(event) => {
                    const sendRecovery = eventSelected(event);
                    setNotifications((current) => ({
                      ...current,
                      send_recovery: sendRecovery,
                    }));
                    onDirty();
                  }}
                />
              </ControlSettingRow>
            </div>
          </section>

          <footer className="save-bar">
            <div className="save-actions notification-actions">
              {setupComplete && (
                <MdTextButton
                  type="button"
                  disabled={saving || testingNotifications}
                  onClick={() => onRevert()}
                >
                  Revert
                </MdTextButton>
              )}
              {webhookConfigured && (
                <MdTextButton
                  type="button"
                  disabled={saving || testingNotifications}
                  onClick={() => onRemoveWebhook()}
                >
                  Remove webhook
                </MdTextButton>
              )}
              <MdOutlinedButton
                type="button"
                disabled={
                  saving ||
                  testingNotifications ||
                  !webhookConfigured ||
                  discordWebhookChanged
                }
                onClick={() => onTestNotifications()}
              >
                {testingNotifications ? "Sending…" : "Send test"}
              </MdOutlinedButton>
              <MdFilledButton type="submit" disabled={saving || !notificationSettingsValid}>
                {saving ? "Saving…" : "Save notifications"}
              </MdFilledButton>
            </div>
          </footer>
          {notice && <div className="message success bottom-notice" role="status">{notice}</div>}
          {visibleError && (
            <div className="message error bottom-message" role="alert">
              <strong>Couldn’t continue.</strong> {visibleError}
            </div>
          )}
        </form>
  );
}
