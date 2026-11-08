import type { Page, PageOptions } from '@sidechannel/contracts/analysis/jev-repository';

export type PageFetcher<T> = (options: PageOptions) => Promise<Page<T>>;

/** Follows `nextCursor` until a page reports none; yields items in server order. */
export async function* iteratePages<T>(fetch: PageFetcher<T>, limit = 500): AsyncGenerator<T> {
    let after: string | undefined;
    for (;;) {
        const page = await fetch({ limit, ...(after === undefined ? {} : { after }) });
        for (const item of page.items) yield item;
        if (page.nextCursor === null) return;
        after = page.nextCursor;
    }
}

export async function collectPages<T>(fetch: PageFetcher<T>, limit = 500): Promise<T[]> {
    const items: T[] = [];
    for await (const item of iteratePages(fetch, limit)) items.push(item);
    return items;
}
