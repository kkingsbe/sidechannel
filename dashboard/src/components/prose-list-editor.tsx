import { Button, Field, Textarea } from './ui';

/** Each criterion remains a separate record; line breaks belong to that item. */
export function ProseListEditor({ label, values, onChange }: {
  label: string; values: string[]; onChange: (values: string[]) => void;
}) {
  return <fieldset className="prose-list full"><legend>{label}</legend>
    <p className="helper">Each entry is a separate item. Line breaks within an entry are preserved.</p>
    {values.map((value, index) => <div className="prose-list-item" key={index}>
      <Field label={`${label} item ${index + 1}`}><Textarea rows={4} expandable editorLabel={`${label} item ${index + 1}`} value={value}
        onChange={event => onChange(values.map((item, position) => position === index ? event.target.value : item))} /></Field>
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange(values.filter((_, position) => position !== index))}>Remove {label.toLowerCase()} item {index + 1}</Button>
    </div>)}
    <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...values, ''])}>Add {label.toLowerCase()} item</Button>
  </fieldset>;
}
