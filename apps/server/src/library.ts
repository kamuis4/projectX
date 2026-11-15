import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  packSchema,
  settingsSchema,
  safeLabel,
  type PackRecord,
  type PackStatus,
  type Preset,
  type WordPack,
} from "@spyfall/shared";
import { GameError, hash } from "./engine";
type Item = {
  id: string;
  ownerKey: string;
  kind: "pack" | "preset";
  payload: unknown;
  status: PackStatus;
  revision: number;
  updatedAt: Date;
};
type User = { id: string; email: string };
export class LibraryStore {
  private items = new Map<string, Item>();
  constructor(private db: PrismaClient | null) {}
  async all() {
    if (this.db) return (await this.db.libraryItem.findMany()) as Item[];
    return structuredClone([...this.items.values()]);
  }
  async get(id: string) {
    if (this.db)
      return (await this.db.libraryItem.findUnique({
        where: { id },
      })) as Item | null;
    return structuredClone(this.items.get(id) ?? null);
  }
  async put(item: Item) {
    if (this.db) {
      const data = { ...item, payload: item.payload as Prisma.InputJsonValue };
      await this.db.libraryItem.upsert({
        where: { id: item.id },
        create: data,
        update: data,
      });
    } else this.items.set(item.id, structuredClone(item));
  }
  async replace(item: Item, expectedRevision: number) {
    if (this.db) {
      const data = { ...item, payload: item.payload as Prisma.InputJsonValue };
      const result = await this.db.libraryItem.updateMany({
        where: {
          id: item.id,
          ownerKey: item.ownerKey,
          revision: expectedRevision,
        },
        data,
      });
      if (result.count !== 1)
        throw new GameError("La version a changé. Rechargez le pack.");
    } else {
      const current = this.items.get(item.id);
      if (!current || current.revision !== expectedRevision)
        throw new GameError("La version a changé. Rechargez le pack.");
      this.items.set(item.id, structuredClone(item));
    }
  }
  async moderate(
    id: string,
    revision: number,
    status: "approved" | "rejected",
  ) {
    if (this.db) {
      const result = await this.db.libraryItem.updateMany({
        where: { id, kind: "pack", status: "pending", revision },
        data: { status },
      });
      if (result.count !== 1)
        throw new GameError(
          "La version a changé. Relisez le pack avant validation.",
        );
    } else {
      const item = this.items.get(id);
      if (
        !item ||
        item.kind !== "pack" ||
        item.status !== "pending" ||
        item.revision !== revision
      )
        throw new GameError(
          "La version a changé. Relisez le pack avant validation.",
        );
      item.status = status;
    }
  }
  async remove(id: string) {
    if (this.db) await this.db.libraryItem.deleteMany({ where: { id } });
    else this.items.delete(id);
  }
  async expireGuests() {
    const threshold = new Date(Date.now() - 30 * 86400000);
    if (this.db)
      await this.db.libraryItem.deleteMany({
        where: {
          ownerKey: { startsWith: "guest:" },
          updatedAt: { lt: threshold },
        },
      });
    else
      for (const item of this.items.values())
        if (item.ownerKey.startsWith("guest:") && item.updatedAt < threshold)
          this.items.delete(item.id);
  }
  async removeOwner(ownerKey: string) {
    if (this.db) await this.db.libraryItem.deleteMany({ where: { ownerKey } });
    else
      for (const item of this.items.values())
        if (item.ownerKey === ownerKey) this.items.delete(item.id);
  }
  record(item: Item): PackRecord {
    if (item.kind !== "pack") throw new GameError("Pack introuvable.");
    return {
      id: item.id,
      ownerKey: item.ownerKey,
      status: item.status,
      revision: item.revision,
      updatedAt: item.updatedAt.getTime(),
      pack: packSchema.parse(item.payload),
    };
  }
  async packFor(id: string, ownerKey: string) {
    const item = await this.get(id);
    if (
      !item ||
      item.kind !== "pack" ||
      (item.ownerKey !== ownerKey && item.status !== "approved")
    )
      throw new GameError("Ce pack est privé ou non validé.");
    return this.record(item);
  }
}
export function registerLibrary(
  app: FastifyInstance,
  db: PrismaClient | null,
  authUser: (token?: string) => Promise<User | null>,
  moderators: string[],
) {
  const store = new LibraryStore(db);
  const owner = async (req: FastifyRequest, reply?: FastifyReply) => {
    const user = await authUser(req.cookies.account);
    if (user)
      return {
        key: `user:${user.id}`,
        moderator: moderators.includes(user.email.toLowerCase()),
      };
    let token = req.cookies.library;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      if (!reply)
        throw new GameError(
          "Ouvrez votre bibliothèque avant de sélectionner un pack privé.",
        );
      token = randomBytes(32).toString("hex");
      reply.setCookie("library", token, {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 86400,
      });
    }
    return { key: `guest:${hash(token)}`, moderator: false };
  };
  const own = async (id: string, key: string) => {
    const item = await store.get(id);
    if (!item || item.ownerKey !== key)
      throw new GameError("Élément introuvable ou accès refusé.");
    return item;
  };
  const summary = (item: Item) => {
    const r = store.record(item);
    return {
      id: r.id,
      name: r.pack.name,
      status: r.status,
      revision: r.revision,
      wordCount: r.pack.words.length,
      categories: [...new Set(r.pack.words.map((w) => w.category))],
    };
  };
  app.get("/api/library", async (req, reply) => {
    const who = await owner(req, reply);
    const items = await store.all();
    return {
      packs: items
        .filter((i) => i.kind === "pack" && i.ownerKey === who.key)
        .map((i) => ({ ...summary(i), pack: i.payload })),
      catalog: items
        .filter((i) => i.kind === "pack" && i.status === "approved")
        .map(summary),
      presets: items
        .filter((i) => i.kind === "preset" && i.ownerKey === who.key)
        .map((i) => ({ id: i.id, ...(i.payload as Omit<Preset, "id">) })),
      moderator: who.moderator,
      queue: who.moderator
        ? items
            .filter((i) => i.kind === "pack" && i.status === "pending")
            .map((i) => ({ ...summary(i), pack: i.payload }))
        : [],
    };
  });
  app.post("/api/packs", { bodyLimit: 512000 }, async (req, reply) => {
    const who = await owner(req, reply);
    const pack = packSchema.parse(req.body);
    const owned = (await store.all()).filter((i) => i.ownerKey === who.key);
    if (owned.length >= 50)
      throw new GameError("50 éléments maximum dans votre bibliothèque.");
    const item: Item = {
      id: randomUUID(),
      ownerKey: who.key,
      kind: "pack",
      payload: pack,
      status: "private",
      revision: 1,
      updatedAt: new Date(),
    };
    await store.put(item);
    return { id: item.id };
  });
  app.get<{ Params: { id: string } }>("/api/packs/:id", async (req, reply) => {
    const who = await owner(req, reply);
    return (await store.packFor(req.params.id, who.key)).pack;
  });
  app.put<{ Params: { id: string } }>(
    "/api/packs/:id",
    { bodyLimit: 512000 },
    async (req, reply) => {
      const who = await owner(req, reply);
      const item = await own(req.params.id, who.key);
      if (item.kind !== "pack") throw new GameError("Pack introuvable.");
      const expectedRevision = item.revision;
      item.payload = packSchema.parse(req.body);
      item.revision++;
      item.updatedAt = new Date();
      if (item.status !== "private") item.status = "pending";
      await store.replace(item, expectedRevision);
      return { ok: true };
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/library/:id",
    async (req, reply) => {
      const who = await owner(req, reply);
      await own(req.params.id, who.key);
      await store.remove(req.params.id);
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/packs/:id/submit",
    async (req, reply) => {
      const who = await owner(req, reply);
      const item = await own(req.params.id, who.key);
      if (item.kind !== "pack") throw new GameError("Pack introuvable.");
      item.status = "pending";
      await store.put(item);
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/packs/:id/moderate",
    async (req, reply) => {
      const who = await owner(req, reply);
      if (!who.moderator)
        return reply
          .code(403)
          .send({ error: "Action réservée aux modérateurs." });
      const decision = z
        .object({
          status: z.enum(["approved", "rejected"]),
          revision: z.number().int().min(1),
        })
        .parse(req.body);
      await store.moderate(req.params.id, decision.revision, decision.status);
      return { ok: true };
    },
  );
  app.post("/api/presets", async (req, reply) => {
    const who = await owner(req, reply);
    const data = z
      .object({ name: safeLabel, settings: settingsSchema })
      .parse(req.body);
    if (data.settings.tournament && data.settings.rounds < 5)
      throw new GameError("Un tournoi comporte 5 à 10 manches.");
    if ((await store.all()).filter((i) => i.ownerKey === who.key).length >= 50)
      throw new GameError("50 éléments maximum.");
    const item: Item = {
      id: randomUUID(),
      ownerKey: who.key,
      kind: "preset",
      payload: data,
      status: "private",
      revision: 1,
      updatedAt: new Date(),
    };
    await store.put(item);
    return { id: item.id };
  });
  return { store, owner };
}
export function emptyPack(): WordPack {
  return { version: 1, name: "Mon univers", description: "", words: [] };
}
