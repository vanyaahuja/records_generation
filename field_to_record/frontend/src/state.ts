import type { ClinicalEvent } from "./generated";
export type Event = Required<ClinicalEvent>;
export type Extraction = {
  extraction_id: string;
  events: Event[];
  narrative: string;
  recorded_at: string;
  timings_ms: { extract: number };
};
export type State = {
  narrative: string;
  events: Event[];
  extraction: Extraction | null;
  recordId: string;
  version: number;
  selected: [number, number] | null;
};
export type Action =
  | { type: "narrative"; value: string }
  | { type: "extracted"; value: Extraction }
  | { type: "events"; value: Event[] }
  | { type: "saved"; id: string; version: number }
  | { type: "select"; value: [number, number] | null }
  | { type: "open"; value: State };
export const sample =
  "At 14:05, gave 500 mg paracetamol orally. At 14:10, recorded blood pressure 120/80. At 14:12, performed bandaging. At 14:14, administered salbutamol by inhalation.";
export const initial: State = {
  narrative: sample,
  events: [],
  extraction: null,
  recordId: "",
  version: 0,
  selected: null,
};
export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "narrative":
      return { ...initial, narrative: action.value };
    case "extracted":
      return {
        ...state,
        events: action.value.events,
        extraction: action.value,
        recordId: "",
        version: 0,
        selected: null,
      };
    case "events":
      return { ...state, events: action.value };
    case "saved":
      return { ...state, recordId: action.id, version: action.version };
    case "select":
      return { ...state, selected: action.value };
    case "open":
      return action.value;
  }
}
