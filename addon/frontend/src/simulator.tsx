import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  MdFilledButton,
  MdOutlinedButton,
  MdOutlinedSelect,
  MdOutlinedTextField,
  MdSelectOption,
  MdTextButton,
} from "./material";
import "@material/web/typography/md-typescale-styles.css";
import "./theme.css";
import "./simulator.css";

type Scenario = {
  id: string;
  label: string;
  description: string;
  active: boolean;
};

type Room = {
  slug: string;
  name: string;
  sensor_temperature: number;
  setpoint: number;
  hvac_mode: "heat" | "off";
};

type Relay = {
  id: string;
  label: string;
  state: "on" | "off";
};

type SimulatorState = {
  current_scenario: string;
  configured: boolean;
  heating_url: string;
  scenarios: Scenario[];
  rooms: Room[];
  relays: Relay[];
};

function Simulator() {
  const [state, setState] = useState<SimulatorState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/__harness/state")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Simulator state failed (${response.status})`);
        return response.json() as Promise<SimulatorState>;
      })
      .then(setState)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  if (error) return <main className="simulator-shell"><div className="sim-message">{error}</div></main>;
  if (!state) return <main className="simulator-shell"><div className="sim-loading">Loading simulator…</div></main>;

  return (
    <main className="simulator-shell">
      <header className="sim-header">
        <div>
          <p className="sim-eyebrow">Local simulator</p>
          <h1 className="md-typescale-display-small">Imaginary Home Assistant</h1>
          <p className="md-typescale-body-large">
            Change fake devices here, then rescan them in Home Heating.
          </p>
        </div>
        <MdTextButton href={state.heating_url}>Open Home Heating</MdTextButton>
      </header>

      <section className="sim-section">
        <div className="sim-section-heading">
          <div>
            <h2 className="md-typescale-headline-small">Discovery scenarios</h2>
            <p>Test onboarding against healthy and incomplete systems.</p>
          </div>
          <span className="sim-chip">{state.current_scenario}</span>
        </div>
        <div className="scenario-grid">
          {state.scenarios.map((scenario) => {
            const ScenarioButton = scenario.active ? MdFilledButton : MdOutlinedButton;
            return (
              <form method="post" action={`/__harness/scenario/${scenario.id}`} key={scenario.id}>
                <ScenarioButton type="submit" className="scenario-button">
                  <span><strong>{scenario.label}</strong><small>{scenario.description}</small></span>
                </ScenarioButton>
              </form>
            );
          })}
        </div>
      </section>

      <section className="sim-section">
        <div className="sim-section-heading">
          <div>
            <h2 className="md-typescale-headline-small">Room devices</h2>
            <p>Adjust thermometer readings, TRV targets, and operating modes.</p>
          </div>
        </div>
        <div className="room-grid">
          {state.rooms.map((room) => (
            <form className="room-card" method="post" action={`/__harness/room/${room.slug}`} key={room.slug}>
              <h3 className="md-typescale-title-large">{room.name}</h3>
              <div className="room-fields">
                <MdOutlinedTextField
                  label="Room sensor °C"
                  name="sensor_temperature"
                  type="number"
                  min="5"
                  max="35"
                  step="0.1"
                  value={String(room.sensor_temperature)}
                  required
                />
                <MdOutlinedTextField
                  label="TRV target °C"
                  name="setpoint"
                  type="number"
                  min="5"
                  max="35"
                  step="0.5"
                  value={String(room.setpoint)}
                  required
                />
                <MdOutlinedSelect label="TRV mode" name="hvac_mode" value={room.hvac_mode} required>
                  <MdSelectOption value="heat">Heat</MdSelectOption>
                  <MdSelectOption value="off">Off</MdSelectOption>
                </MdOutlinedSelect>
                <MdFilledButton type="submit">Apply</MdFilledButton>
              </div>
            </form>
          ))}
        </div>
      </section>

      <section className="sim-section">
        <div className="sim-section-heading">
          <div>
            <h2 className="md-typescale-headline-small">Boiler relays</h2>
            <p>Toggle the two imaginary physical relay channels.</p>
          </div>
        </div>
        <div className="relay-grid">
          {state.relays.map((relay) => (
            <form method="post" action={`/__harness/relay/${relay.id}`} key={relay.id}>
              <MdOutlinedButton type="submit" className="relay-button">
                {relay.label} · {relay.state.toUpperCase()}
              </MdOutlinedButton>
            </form>
          ))}
        </div>
      </section>

      <footer className="sim-footer">
        <span>{state.configured ? "A test configuration is saved." : "No test configuration is saved."}</span>
        <form method="post" action="/__harness/reset">
          <MdTextButton type="submit" disabled={!state.configured}>Reset saved configuration</MdTextButton>
        </form>
      </footer>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Simulator />);
