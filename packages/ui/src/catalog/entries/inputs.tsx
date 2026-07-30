import { SearchIcon } from "lucide-react"

import { Field, FieldDescription, FieldLabel } from "@humanctl/ui/components/field"
import { Input } from "@humanctl/ui/components/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@humanctl/ui/components/input-group"
import { Label } from "@humanctl/ui/components/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@humanctl/ui/components/select"
import { Textarea } from "@humanctl/ui/components/textarea"

import type { CatalogEntry } from "../registry"

const harnessItems = [
  { label: "All harnesses", value: "all" },
  { label: "Codex", value: "codex" },
  { label: "Claude Code", value: "claude" },
]

export const inputEntries: CatalogEntry[] = [
  {
    id: "input",
    name: "Input",
    kind: "component",
    category: "Inputs",
    importPath: "components/input",
    exports: ["Input"],
    blurb: "The single-line text field. Pair it with Field for a label and help text, or InputGroup for an addon.",
    tags: ["text", "form"],
    states: [
      {
        name: "Default",
        description: "resting and filled",
        render: () => (
          <div className="flex w-full max-w-sm flex-col gap-3">
            <Input placeholder="Search sessions" aria-label="Search sessions" />
            <Input defaultValue="refill-router" aria-label="Workspace" />
          </div>
        ),
      },
      {
        name: "Disabled",
        description: "non-editable",
        render: () => (
          <Input disabled defaultValue="read-only" aria-label="Disabled input" className="w-full max-w-sm" />
        ),
      },
    ],
    accessibility: [
      "Always give an accessible name via Field, Label, or aria-label.",
      "Focus shows a 2px ring; the resting border never disappears.",
    ],
    usage: `<Field>
  <FieldLabel htmlFor="q">Search</FieldLabel>
  <Input id="q" placeholder="Search sessions" />
</Field>`,
  },
  {
    id: "textarea",
    name: "Textarea",
    kind: "component",
    category: "Inputs",
    importPath: "components/textarea",
    exports: ["Textarea"],
    blurb: "The multiline text field for notes and freeform prompts. The Composer block wraps it for replies.",
    tags: ["multiline", "form"],
    states: [
      {
        name: "Default",
        description: "resting",
        render: () => (
          <Textarea
            aria-label="Note"
            placeholder="Leave a note for the next session"
            className="w-full max-w-md"
            rows={3}
          />
        ),
      },
    ],
    accessibility: ["Give it an accessible name and let it grow to its content where the layout allows."],
    usage: `<Textarea aria-label="Note" placeholder="Leave a note" rows={3} />`,
  },
  {
    id: "label",
    name: "Label",
    kind: "component",
    category: "Inputs",
    importPath: "components/label",
    exports: ["Label"],
    blurb: "A control label bound to its input. Field composes it; use Label directly for one-off controls.",
    tags: ["form"],
    states: [
      {
        name: "Bound label",
        description: "htmlFor ties label to input",
        render: () => (
          <div className="flex w-full max-w-sm flex-col gap-1.5">
            <Label htmlFor="label-demo">Task ID</Label>
            <Input id="label-demo" placeholder="019f..." />
          </div>
        ),
      },
    ],
    accessibility: ["Clicking the label focuses its control through the htmlFor / id pairing."],
    usage: `<Label htmlFor="task">Task ID</Label>
<Input id="task" />`,
  },
  {
    id: "field",
    name: "Field",
    kind: "component",
    category: "Inputs",
    importPath: "components/field",
    exports: ["Field", "FieldLabel", "FieldDescription"],
    blurb: "The form-row owner: label, control, and help text as one accessible unit with consistent spacing.",
    tags: ["form", "composition"],
    states: [
      {
        name: "Label and description",
        description: "the standard field anatomy",
        render: () => (
          <Field className="w-full max-w-sm">
            <FieldLabel htmlFor="field-demo">Search</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput id="field-demo" placeholder="Search sessions" />
            </InputGroup>
            <FieldDescription>Matches title, workspace, and task ID.</FieldDescription>
          </Field>
        ),
      },
    ],
    props: [
      { name: "FieldLabel", type: "ReactNode", note: "Owns the label; pass htmlFor to bind it to the control." },
      { name: "FieldDescription", type: "ReactNode", note: "Help text below the control, in muted ink." },
    ],
    accessibility: ["The label and description are associated with the control so both are announced."],
    usage: `<Field>
  <FieldLabel htmlFor="q">Search</FieldLabel>
  <Input id="q" />
  <FieldDescription>Matches title, workspace, and task ID.</FieldDescription>
</Field>`,
  },
  {
    id: "input-group",
    name: "InputGroup",
    kind: "component",
    category: "Inputs",
    importPath: "components/input-group",
    exports: ["InputGroup", "InputGroupAddon", "InputGroupInput"],
    blurb: "A compound control that joins an input with leading or trailing addons like a search icon or a unit.",
    tags: ["addon", "composition"],
    states: [
      {
        name: "Leading addon",
        description: "icon inside the field",
        render: () => (
          <InputGroup className="w-full max-w-sm">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search sessions" aria-label="Search sessions" />
          </InputGroup>
        ),
      },
    ],
    accessibility: ["The addon is decorative; the InputGroupInput still needs an accessible name."],
    usage: `<InputGroup>
  <InputGroupAddon><SearchIcon /></InputGroupAddon>
  <InputGroupInput placeholder="Search sessions" />
</InputGroup>`,
  },
  {
    id: "select",
    name: "Select",
    kind: "component",
    category: "Inputs",
    importPath: "components/select",
    exports: ["Select", "SelectContent", "SelectGroup", "SelectItem", "SelectTrigger", "SelectValue"],
    blurb: "A single-choice dropdown for a closed option list. Shows operator labels, never raw enum values.",
    tags: ["dropdown", "single-select"],
    states: [
      {
        name: "Closed",
        description: "resting trigger with the current value",
        render: () => (
          <Select items={harnessItems} defaultValue="all">
            <SelectTrigger aria-label="Harness" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {harnessItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ),
      },
    ],
    props: [
      { name: "items", type: "{ label, value }[]", note: "The option set, used for the trigger value and typeahead." },
      { name: "value / onValueChange", type: "string / (v) => void", note: "Controlled selection." },
    ],
    accessibility: [
      "Full keyboard support: open, arrow between options, type to jump, Escape to dismiss.",
      "The trigger carries an aria-label when no visible label sits beside it.",
    ],
    usage: `<Select items={harnesses} value={value} onValueChange={setValue}>
  <SelectTrigger aria-label="Harness"><SelectValue /></SelectTrigger>
  <SelectContent>
    <SelectGroup>{/* SelectItem per option */}</SelectGroup>
  </SelectContent>
</Select>`,
  },
]
