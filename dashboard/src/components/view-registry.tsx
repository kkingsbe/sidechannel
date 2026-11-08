import type { ComponentType, ReactElement } from "react";
import type { ViewRegistry } from "../lib/contracts";
import { Card, Empty, Tabs } from "./ui";

export function tabItems<TabId extends string>(registry: ViewRegistry<TabId>, order: readonly TabId[]): { id: TabId; label: string }[] {
  return order.map((id) => ({ id, label: registry[id].title }));
}

/**
 * One tab list, one panel. `Tabs` generates `` `${panelId}-tab-${id}` `` ids, so the panel's
 * `aria-labelledby` is derived instead of re-typed by each page.
 */
export function ViewPanel<TabId extends string>({
  registry,
  order,
  tab,
  panelId,
  onChange,
}: {
  registry: ViewRegistry<TabId>;
  order: readonly TabId[];
  tab: string;
  panelId: string;
  onChange: (tab: TabId) => void;
}): ReactElement {
  const entry = (registry as Record<string, { Component: ComponentType } | undefined>)[tab];
  const Active = entry?.Component;
  return (
    <>
      <Tabs panelId={panelId} value={tab} onChange={(value) => onChange(value as TabId)} items={tabItems(registry, order)} />
      <section
        role="tabpanel"
        id={panelId}
        {...(Active ? { "aria-labelledby": `${panelId}-tab-${tab}` } : { "aria-label": "Unknown view" })}
        tabIndex={0}
      >
        {Active ? <Active /> : <NotFoundView what={tab} />}
      </section>
    </>
  );
}

export function NotFoundView({ what }: { what: string }): ReactElement {
  return (
    <Card>
      <Empty
        title="This view does not exist"
        description={`“${what}” is not a view on this page. Choose another tab; nothing was changed.`}
      />
    </Card>
  );
}
