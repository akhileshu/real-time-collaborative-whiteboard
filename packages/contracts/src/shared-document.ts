import * as Y from "yjs";

import {
  sceneOperationSchema,
  wireShapeSchema,
  type SceneOperation,
  type WireShape,
} from "./document-operations";

const LOCAL_ORIGIN = "local";
const REMOTE_ORIGIN = "remote";
const INITIAL_ORIGIN = "initial";

type ShapeRecord = Y.Map<unknown>;

export type SharedDocumentEvents = {
  onScene?: (scene: readonly WireShape[]) => void;
  onLocalUpdate?: (update: Uint8Array) => void;
  onApplyError?: (reason: string) => void;
};

export type SharedDocument = {
  readonly scene: readonly WireShape[];
  applyOperation: (operation: SceneOperation) => boolean;
  clear: () => boolean;
  applyUpdate: (update: Uint8Array) => boolean;
  encodeState: () => Uint8Array;
  destroy: () => void;
};

export function encodeDocumentUpdate(update: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < update.length; index += 1) {
    binary += String.fromCharCode(update[index] ?? 0);
  }
  return btoa(binary);
}

export function decodeDocumentUpdate(value: string): Uint8Array {
  const binary = atob(value);
  const update = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    update[index] = binary.charCodeAt(index);
  }
  return update;
}

function pointRecord(point: { x: number; y: number }): Y.Map<number> {
  const record = new Y.Map<number>();
  record.set("x", point.x);
  record.set("y", point.y);
  return record;
}

function shapeRecord(shape: WireShape): ShapeRecord {
  const record = new Y.Map<unknown>();
  record.set("id", shape.id);
  record.set("type", shape.type);
  record.set("fill", shape.fill);

  if (shape.type === "rectangle") {
    record.set("position", pointRecord(shape.position));
    record.set("width", shape.width);
    record.set("height", shape.height);
  } else {
    record.set("center", pointRecord(shape.center));
    record.set("radius", shape.radius);
  }

  return record;
}

function readPoint(value: unknown): { x: number; y: number } | null {
  if (!(value instanceof Y.Map)) return null;
  const x = value.get("x");
  const y = value.get("y");
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function readShape(value: unknown): WireShape | null {
  if (!(value instanceof Y.Map)) return null;
  const type = value.get("type");
  const id = value.get("id");
  const fill = value.get("fill");
  if (typeof type !== "string" || typeof id !== "string" || typeof fill !== "string") {
    return null;
  }

  const point = readPoint(value.get(type === "rectangle" ? "position" : "center"));
  if (!point) return null;

  const candidate = type === "rectangle"
    ? {
        id,
        type: "rectangle" as const,
        position: point,
        width: value.get("width"),
        height: value.get("height"),
        fill,
      }
    : {
        id,
        type: "circle" as const,
        center: point,
        radius: value.get("radius"),
        fill,
      };

  const parsed = wireShapeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function project(doc: Y.Doc):
  | { ok: true; scene: readonly WireShape[] }
  | { ok: false; reason: string } {
  const order = doc.getArray<string>("shape-order");
  const shapes = doc.getMap<ShapeRecord>("shapes");
  const ids = order.toArray();
  const scene: WireShape[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) return { ok: false, reason: "The shape order contains a duplicate ID." };
    seen.add(id);
    const shape = readShape(shapes.get(id));
    if (!shape) return { ok: false, reason: "The document contains an invalid shape." };
    scene.push(shape);
  }

  if (scene.length > 10_000 || shapes.size !== scene.length) {
    return { ok: false, reason: "The document contains too many or orphaned shapes." };
  }
  return { ok: true, scene };
}

function seed(doc: Y.Doc, initialScene: readonly WireShape[]): void {
  const parsed = initialScene.map((shape) => wireShapeSchema.parse(shape));
  const order = doc.getArray<string>("shape-order");
  const shapes = doc.getMap<ShapeRecord>("shapes");

  doc.transact(() => {
    for (const shape of parsed) {
      if (shapes.has(shape.id)) throw new Error(`Duplicate shape ID: ${shape.id}`);
      shapes.set(shape.id, shapeRecord(shape));
      order.push([shape.id]);
    }
  }, INITIAL_ORIGIN);
}

function updatePosition(record: ShapeRecord, operation: Extract<SceneOperation, { kind: "move" }>): void {
  const key = record.get("type") === "rectangle" ? "position" : "center";
  record.set(key, pointRecord(operation.position));
}

function createDocument(
  initialScene: readonly WireShape[],
  events: SharedDocumentEvents = {},
  state?: Uint8Array,
): SharedDocument {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, state, REMOTE_ORIGIN);
  else seed(doc, initialScene);

  const initialProjection = project(doc);
  if (!initialProjection.ok) {
    doc.destroy();
    throw new Error(initialProjection.reason);
  }

  let scene = initialProjection.scene;
  const handleUpdate = (update: Uint8Array, origin: unknown) => {
    const next = project(doc);
    if (!next.ok) {
      events.onApplyError?.(next.reason);
      return;
    }
    scene = next.scene;
    events.onScene?.(scene);
    if (origin === LOCAL_ORIGIN) events.onLocalUpdate?.(update);
  };
  doc.on("update", handleUpdate);

  return {
    get scene() {
      return scene;
    },
    applyOperation(operation) {
      const parsed = sceneOperationSchema.safeParse(operation);
      if (!parsed.success) return false;
      let changed = false;
      doc.transact(() => {
        const shapes = doc.getMap<ShapeRecord>("shapes");
        const order = doc.getArray<string>("shape-order");
        if (parsed.data.kind === "create") {
          if (shapes.has(parsed.data.shape.id)) return;
          shapes.set(parsed.data.shape.id, shapeRecord(parsed.data.shape));
          order.push([parsed.data.shape.id]);
          changed = true;
          return;
        }
        const record = shapes.get(parsed.data.shapeId);
        if (!record) return;
        updatePosition(record, parsed.data);
        changed = true;
      }, LOCAL_ORIGIN);
      return changed;
    },
    clear() {
      const shapes = doc.getMap<ShapeRecord>("shapes");
      const order = doc.getArray<string>("shape-order");
      if (shapes.size === 0 && order.length === 0) return false;

      doc.transact(() => {
        order.delete(0, order.length);
        shapes.forEach((_shape, id) => shapes.delete(id));
      }, LOCAL_ORIGIN);
      return true;
    },
    applyUpdate(update) {
      try {
        Y.applyUpdate(doc, update, REMOTE_ORIGIN);
        return project(doc).ok;
      } catch (error) {
        events.onApplyError?.(error instanceof Error ? error.message : "Unable to apply document update.");
        return false;
      }
    },
    encodeState() {
      return Y.encodeStateAsUpdate(doc);
    },
    destroy() {
      doc.off("update", handleUpdate);
      doc.destroy();
    },
  };
}

export function createSharedDocument(
  initialScene: readonly WireShape[],
  events?: SharedDocumentEvents,
): SharedDocument {
  return createDocument(initialScene, events);
}

export function createSharedDocumentFromState(
  state: Uint8Array,
  events?: SharedDocumentEvents,
): SharedDocument {
  return createDocument([], events, state);
}
