// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge, Drawer, EventIcon, Field, Input, Tabs } from './ui';
import { ProseListEditor } from './prose-list-editor';

afterEach(cleanup);

it('takes a semantic tone instead of a domain status', () => {
  render(<><Badge tone="success">Done</Badge><Badge tone="danger">Broken</Badge><Badge>Plain</Badge></>);
  const [done, broken, plain] = screen.getAllByText(/Done|Broken|Plain/);
  expect(done!.className).toContain('badge-success');
  expect(broken!.className).toContain('badge-danger');
  expect(plain!.className).not.toMatch(/badge-(success|warning|danger)/);
});

it('renders one icon per event icon name', () => {
  const { container } = render(<><EventIcon name="error" /><EventIcon name="board" /><EventIcon name="tool" /><EventIcon name="success" /><EventIcon name="default" /></>);
  expect(container.querySelectorAll('svg')).toHaveLength(5);
});

it('moves keyboard focus and selection together and labels the active panel', async () => {
  function Views() {
    const [view, setView] = useState('summary');
    return <><Tabs value={view} onChange={setView} panelId="evidence" items={[{id:'summary',label:'Summary'},{id:'events',label:'Events'}]} />
      <section role="tabpanel" id="evidence" aria-labelledby={`evidence-tab-${view}`}>{view}</section></>;
  }
  render(<Views />); const user = userEvent.setup();
  await user.tab(); await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(screen.getByRole('tab', {name:'Events'}));
  expect(screen.getByRole('tab', {name:'Events'}).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel', {name:'Events'}).textContent).toBe('events');
  await user.keyboard('{Home}');
  expect(document.activeElement).toBe(screen.getByRole('tab', {name:'Summary'}));
});

it('exposes required and invalid states without changing the field name', () => {
  render(<Field label="Researcher" required error="Enter your name"><Input /></Field>);
  const input = screen.getByLabelText('Researcher');
  expect(input.getAttribute('aria-required')).toBe('true');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Enter your name');
});

it('preserves multiline criteria and focus through expanded editing', async () => {
  function Editor() {
    const [values, setValues] = useState(['First line\nSecond line']);
    return <ProseListEditor label="Inclusion criteria" values={values} onChange={setValues} />;
  }
  render(<Editor />); const user = userEvent.setup();
  const field = screen.getByLabelText('Inclusion criteria item 1') as HTMLTextAreaElement;
  await user.click(screen.getByRole('button', {name:'Expand Inclusion criteria item 1 editor'}));
  expect(document.activeElement).toBe(field);
  await user.type(field, '\nThird line');
  await user.click(screen.getByRole('button', {name:'Collapse Inclusion criteria item 1 editor'}));
  expect(field.value).toBe('First line\nSecond line\nThird line');
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
});

it('restores focus to the control that opened a programmatic drawer', async () => {
 function Inspector() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Inspect event</button><Drawer title="Event" open={open} onOpenChange={setOpen}>Recorded message</Drawer></>;
 }
 render(<Inspector />); const user = userEvent.setup();
 const trigger = screen.getByRole('button',{name:'Inspect event'});
 await user.click(trigger);
 await user.click(screen.getByRole('button',{name:'Close evidence inspector'}));
 expect(document.activeElement).toBe(trigger);
});

it('shows a default drawer eyebrow and lets callers override it', () => {
 const { rerender } = render(<Drawer title="Event" open onOpenChange={() => {}}>x</Drawer>);
 expect(screen.getByText('Evidence inspector')).toBeTruthy();
 rerender(<Drawer title="Event" eyebrow="Codebook" open onOpenChange={() => {}}>x</Drawer>);
 expect(screen.getByText('Codebook')).toBeTruthy();
 expect(screen.queryByText('Evidence inspector')).toBeNull();
});
