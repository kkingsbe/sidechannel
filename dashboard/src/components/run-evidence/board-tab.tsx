import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { HarnessEvent } from "../../lib/types";
import { Button, Card, CardHeading, Empty, Notice } from "../ui";
import { BoardDeliveries } from "./board-deliveries";
import {
  asPost,
  boardFinding,
  boardModel,
  eventLink,
  plural,
  roleColor,
  rt,
  type BoardModel,
  type PostReads,
} from "./evidence-model";
import { roleAbbreviation } from "../../pages/runs/role-color";
import { parsePost } from "./structure";
import "./run-evidence.css";

const time = (value: string) =>
  value ? new Date(value).toLocaleTimeString(undefined, { timeStyle: "medium" }) : "";

/** One post body with structure: a lead line, key/value rows, a case grid, lists and muted prose. */
export function PostBody({ text }: { text: string }) {
  const blocks = useMemo(() => parsePost(text), [text]);
  const [open, setOpen] = useState(false);
  const long = text.length > 900;
  const content = (
    <div className="ev-post-body">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "lead":
            return (
              <p key={index} className="ev-lead">
                {block.text}
              </p>
            );
          case "cases":
            return (
              <div key={index} className="ev-cases" role="list" aria-label="Case values">
                {block.items.map((item, k) => (
                  <div key={k} role="listitem">
                    <span className="mono">{item.key}</span>
                    <b className={item.value === "0" ? "muted" : undefined}>{item.value}</b>
                  </div>
                ))}
              </div>
            );
          case "kv":
            return (
              <dl key={index} className="kv ev-kv">
                {block.rows.map((row, k) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>{row.key}</dt>
                    <dd>
                      {row.text}
                      {row.items.length > 0 && (
                        <ul>
                          {row.items.map((item, n) => (
                            <li key={n}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            );
          case "list":
            return (
              <div key={index} className="ev-prose">
                <ul>
                  {block.items.map((item, k) => (
                    <li key={k}>{item}</li>
                  ))}
                </ul>
              </div>
            );
          default:
            return (
              <p key={index} className="ev-prose">
                {block.text}
              </p>
            );
        }
      })}
    </div>
  );
  if (!long) return content;
  return (
    <div>
      <div className={open ? undefined : "ev-clamp"}>{content}</div>
      <button
        type="button"
        className="ev-link-btn"
        style={{ marginTop: 8, fontSize: 13 }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Show less" : "Show the full post"}
      </button>
    </div>
  );
}

function ReadsMatrix({ posts, roles }: { posts: PostReads[]; roles: string[] }) {
  return (
    <Card>
      <CardHeading title="Who read each post" description="Turn of first read" />
      <div
        className="ev-matrix"
        role="table"
        aria-label="First read of each post by role"
        style={{ "--cols": roles.length } as CSSProperties}
      >
        <div className="ev-matrix-row muted" role="row">
          <span role="columnheader" />
          {roles.map((role) => (
            <span
              key={role}
              role="columnheader"
              className="who-chip"
              style={{ "--c": roleColor(role) } as CSSProperties}
            >
              <abbr title={role}>
                {roleAbbreviation(role)}
              </abbr>
            </span>
          ))}
        </div>
        {posts.map(({ post, readers }) => (
          <div key={post.id} className="ev-matrix-row" role="row">
            <span role="rowheader" className="muted">
              Post {post.sequence}
            </span>
            {roles.map((role) => {
              if (role === post.authorId)
                return (
                  <span key={role} role="cell" className="muted">
                    author
                  </span>
                );
              const first = readers.find((r) => r.role === role)?.reads[0];
              return first ? (
                <span key={role} role="cell" className="ev-num">
                  <Link to={eventLink(first)}>{`R${first.round ?? "?"} T${first.turn ?? "?"}`}</Link>
                </span>
              ) : (
                <span key={role} role="cell" className="faint" aria-label="not read">
                  —
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="card-foot">
        <span>A dash means the role never read the post before the run ended.</span>
      </div>
    </Card>
  );
}

function DeliveriesCard({ model }: { model: BoardModel }) {
  const { posts, unread, longestWait, mostReRead } = model;
  const unreadPosts = [...new Set(unread.map((u) => u.post.sequence))];
  return (
    <Card>
      <CardHeading title="Deliveries" description="Exact read events" />
      <div className="card-body">
        <dl className="kv" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
          <dt>Posts</dt>
          <dd className="ev-num">{posts.length}</dd>
          <dt>Delivery events</dt>
          <dd>
            {model.deliveryEvents}{" "}
            <span className="muted">
              · {plural(model.firstReads, "first read")}, {plural(model.reReads, "re-read")}
            </span>
          </dd>
          <dt>Never read</dt>
          <dd>
            {unread.length}{" "}
            <span className="muted">
              {unread.length
                ? `· ${unreadPosts.map((n) => "post " + n).join(", ")} not read by every role`
                : "· every post reached every other role"}
            </span>
          </dd>
          {longestWait && (
            <>
              <dt>Longest wait</dt>
              <dd>
                {plural(longestWait.turns, "turn")}{" "}
                <span className="muted">
                  · post {longestWait.post.sequence}, read by {longestWait.role} at {rt(longestWait.event)}
                </span>
              </dd>
            </>
          )}
          {mostReRead && (
            <>
              <dt>Most re-read</dt>
              <dd>
                Post {mostReRead.post.sequence}{" "}
                <span className="muted">
                  · {plural(mostReRead.count, "re-read")}
                  {mostReRead.topCount > 1 ? `, ${mostReRead.topCount} by ${mostReRead.topRole}` : ""}
                </span>
              </dd>
            </>
          )}
        </dl>
      </div>
    </Card>
  );
}

function ReadsPerTurn({ model }: { model: BoardModel }) {
  const turns = Math.max(model.maxTurn, 1);
  const values = Array.from({ length: turns }, (_, k) => model.readsPerTurn.get(k + 1) ?? 0);
  const peak = Math.max(...values, 1);
  const top = Math.max(3, Math.ceil(peak / 3) * 3);
  const W = 330;
  const left = 28;
  const step = (W - left - 4) / turns;
  const bar = Math.max(2, Math.min(14, step - 3));
  const y = (v: number) => 98 - (v / top) * 84;
  const ticks = [
    ...new Set([1, Math.round(turns / 3) + 1, Math.round((turns * 2) / 3) + 1, turns]),
  ]
    .filter((t) => t >= 1 && t <= turns)
    .sort((a, b) => a - b);
  const peaks = values.flatMap((v, k) => (v === peak && peak > 0 ? [k + 1] : []));
  return (
    <Card>
      <CardHeading title="Reads per turn" description="Posts delivered to a non-author role" />
      <div className="card-body">
        <svg
          viewBox={`0 0 ${W} 120`}
          className="ev-bars"
          role="img"
          aria-label={`Board reads per turn, turns 1 to ${turns}; most in turn ${peaks.slice(0, 4).join(", ")}`}
        >
          <g stroke="var(--rule)">
            {[0, 1, 2, 3].map((k) => (
              <line key={k} x1={left} x2={W - 4} y1={98 - k * 28} y2={98 - k * 28} />
            ))}
          </g>
          <g fill="var(--faint)" fontSize="10" textAnchor="end">
            {[0, 1, 2, 3].map((k) => (
              <text key={k} x={left - 5} y={101 - k * 28}>
                {Math.round((top / 3) * k)}
              </text>
            ))}
          </g>
          <g fill="var(--blue)">
            {values.map((v, k) => (
              <rect
                key={k}
                x={left + 2 + k * step}
                y={y(v)}
                width={bar}
                height={98 - y(v)}
                opacity={v === peak ? 1 : 0.35}
              />
            ))}
          </g>
          <g fill="var(--faint)" fontSize="10" textAnchor="middle">
            {ticks.map((t) => (
              <text key={t} x={left + 2 + (t - 1) * step + bar / 2} y={113}>
                T{t}
              </text>
            ))}
          </g>
        </svg>
      </div>
    </Card>
  );
}

/** The board tab: the finding, the posts (structured, first three open) and the read-evidence rail. */
export function BoardTab({
  posts,
  postEvents,
  deliveries,
  roles,
  deliveriesMayHaveMore,
  eventsPartial,
  keyOf,
  onInspect,
}: {
  posts: unknown[];
  postEvents: Map<string, HarnessEvent>;
  deliveries?: HarnessEvent[];
  roles: string[];
  deliveriesMayHaveMore?: boolean;
  eventsPartial?: boolean;
  keyOf: (item: unknown, index: number) => string;
  onInspect: (key: string) => void;
}) {
  const [newest, setNewest] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const model = useMemo(
    () => (deliveries ? boardModel(posts, postEvents, deliveries, roles) : undefined),
    [posts, postEvents, deliveries, roles],
  );
  if (!posts.length)
    return (
      <Empty
        title="No board posts recorded on this page"
        description="Unavailable evidence is distinct from an empty agent action or a negative finding."
      />
    );
  const finding = model ? boardFinding(model, roles) : undefined;
  const raw = posts.map((item, index) => ({ item, post: asPost(item, index), key: keyOf(item, index) }));
  const ordered = newest ? [...raw].reverse() : raw;
  const visible = expanded ? ordered : ordered.slice(0, 3);
  const hidden = ordered.length - visible.length;
  const authors = [...new Set(ordered.slice(3).map((o) => o.post.authorId))];
  return (
    <div className="stack">
      {(deliveriesMayHaveMore || eventsPartial) && (
        <Notice kind="warning">
          {deliveriesMayHaveMore
            ? "This response holds one page of delivery events, so reads after the page are not shown. Filter the timeline for board_delivery for the complete history."
            : "Recorded event history was capped; round, turn and read details on this tab may be incomplete."}
        </Notice>
      )}
      <div className="ev-head">
        <p className="finding">
          {finding ? (
            <>
              <strong>{finding.strong}</strong>
              {finding.rest}
            </>
          ) : (
            <>
              <strong>No read or delivery events were loaded.</strong> Posting alone does not establish receipt.
            </>
          )}
        </p>
        <div className="seg" role="group" aria-label="Order">
          <button type="button" aria-pressed={!newest} onClick={() => setNewest(false)}>
            Oldest first
          </button>
          <button type="button" aria-pressed={newest} onClick={() => setNewest(true)}>
            Newest first
          </button>
        </div>
      </div>
      <div className="g12">
        <div className="c8 stack">
          {visible.map(({ post, key }) => {
            const event = postEvents.get(post.id);
            const meta = [
              event?.round !== undefined && event?.turn !== undefined
                ? `Round ${event.round} · turn ${event.turn}`
                : event?.round !== undefined
                  ? `Round ${event.round}`
                  : "Round and turn not loaded",
              time(post.timestamp),
              event ? `event #${event.sequence}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Card key={key}>
                <CardHeading
                  ruled
                  title={`Post ${post.sequence}`}
                  count={post.authorId}
                  description={meta}
                  actions={
                    <Button variant="secondary" size="sm" onClick={() => onInspect(key)}>
                      Inspect
                    </Button>
                  }
                />
                <div className="card-body" style={{ paddingTop: 14 }}>
                  <PostBody text={post.text} />
                </div>
                <div className="card-foot ev-reads">
                  <BoardDeliveries
                    postId={post.id}
                    authorId={post.authorId}
                    roles={roles}
                    deliveries={deliveries}
                  />
                </div>
              </Card>
            );
          })}
          {hidden > 0 && (
            <div className="card ev-more">
              <span className="muted">
                {plural(hidden, "more post")} by {authors.slice(0, 4).join(", ")}
                {authors.length > 4 ? " and others" : ""}
              </span>
              <button type="button" className="ev-link-btn" onClick={() => setExpanded(true)}>
                Show {hidden} more {hidden === 1 ? "post" : "posts"}
              </button>
            </div>
          )}
          {expanded && ordered.length > 3 && (
            <button
              type="button"
              className="ev-link-btn"
              style={{ justifySelf: "start" }}
              onClick={() => setExpanded(false)}
            >
              Show only the first 3 posts
            </button>
          )}
        </div>
        <div className="c4 stack">
          {model ? (
            <>
              <ReadsMatrix posts={model.posts} roles={roles} />
              <DeliveriesCard model={model} />
              {model.maxTurn > 0 && model.readsPerTurn.size > 0 && <ReadsPerTurn model={model} />}
            </>
          ) : (
            <Card>
              <CardHeading title="Who read each post" />
              <div className="card-body">
                <p className="helper">Read events were not loaded for this run.</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
