import { useEffect, useState } from "react";
import { useApi } from "./api";
export function useCursorApi<T>(path: string | null, limit = 30, interval = 0) {
  const [page, setPage] = useState(0),
    [cursors, setCursors] = useState<(string | null)[]>([null]);
  useEffect(() => {
    setPage(0);
    setCursors([null]);
  }, [path]);
  const request = useApi<{ items: T[]; nextCursor: string | null }>(
    path
      ? path +
          (path.includes("?") ? "&" : "?") +
          "limit=" +
          limit +
          (cursors[page] ? "&after=" + encodeURIComponent(cursors[page]!) : "")
      : null,
    interval,
  );
  return {
    ...request,
    pagination: {
      page,
      hasMore: !!request.data?.nextCursor,
      onChange: (next: number) => {
        if (next > page)
          setCursors((previous) => [
            ...previous.slice(0, next),
            request.data?.nextCursor ?? null,
          ]);
        setPage(next);
      },
    },
  };
}
export function useOffsetApi<T>(path: string | null, limit = 50, interval = 0) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [path]);
  const request = useApi<{
    items: T[];
    nextOffset: number | null;
    total: number;
  }>(
    path
      ? path +
          (path.includes("?") ? "&" : "?") +
          "limit=" +
          limit +
          "&offset=" +
          page * limit
      : null,
    interval,
  );
  return {
    ...request,
    pagination: {
      page,
      hasMore: request.data?.nextOffset != null,
      onChange: setPage,
    },
  };
}
