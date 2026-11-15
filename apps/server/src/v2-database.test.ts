import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { createServer } from "./server";
import { LibraryStore } from "./library";
import { defaultSettings, type Library, type WordPack } from "@spyfall/shared";
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  "V2 · PostgreSQL, bibliothèque et modération",
  () => {
    it("conserve packs et presets, modère une révision précise et supprime les données du compte", async () => {
      const db = new PrismaClient({ datasourceUrl: databaseUrl });
      const email = `moderation-${randomUUID()}@example.fr`;
      const ownerEmail = `auteur-${randomUUID()}@example.fr`;
      const server = await createServer({ databaseUrl, moderators: [email] });
      const ids: string[] = [];
      const pack: WordPack = {
        version: 1,
        name: "Pack privé de test",
        description: "Test modération",
        words: [
          {
            label: "Antares test",
            category: "Étoiles",
            subcategory: "Supergéantes",
            difficulty: "hard",
            variants: ["Alpha Scorpii test"],
          },
        ],
      };
      try {
        const admin = await server.app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email,
            username: "Moderation",
            password: "correct-horse-42",
          },
        });
        expect(admin.statusCode).toBe(200);
        const adminCookie = String(admin.headers["set-cookie"]).split(";")[0];
        const author = await server.app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email: ownerEmail,
            username: "Auteur",
            password: "correct-horse-42",
          },
        });
        const ownerCookie = String(author.headers["set-cookie"]).split(";")[0];
        const created = await server.app.inject({
          method: "POST",
          url: "/api/packs",
          headers: { cookie: ownerCookie },
          payload: pack,
        });
        expect(created.statusCode).toBe(200);
        const id = created.json().id;
        ids.push(id);
        const preset = await server.app.inject({
          method: "POST",
          url: "/api/presets",
          headers: { cookie: ownerCookie },
          payload: {
            name: "Tournoi test",
            settings: { ...defaultSettings, tournament: true, rounds: 5 },
          },
        });
        expect(preset.statusCode).toBe(200);
        ids.push(preset.json().id);
        const independent = new LibraryStore(db);
        expect((await independent.get(id))?.status).toBe("private");
        expect(await independent.get(preset.json().id)).not.toBeNull();
        await server.app.inject({
          method: "POST",
          url: `/api/packs/${id}/submit`,
          headers: { cookie: ownerCookie },
        });
        const queue = (
          await server.app.inject({
            url: "/api/library",
            headers: { cookie: adminCookie },
          })
        ).json<Library>();
        expect(queue.moderator).toBe(true);
        expect(queue.queue.find((p) => p.id === id)?.revision).toBe(1);
        expect(queue.catalog.some((p) => p.id === id)).toBe(false);
        const denied = await server.app.inject({
          method: "POST",
          url: `/api/packs/${id}/moderate`,
          headers: { cookie: ownerCookie },
          payload: { status: "approved", revision: 1 },
        });
        expect(denied.statusCode).toBe(403);
        const updated = { ...pack, name: "Pack édité" };
        expect(
          (
            await server.app.inject({
              method: "PUT",
              url: `/api/packs/${id}`,
              headers: { cookie: ownerCookie },
              payload: updated,
            })
          ).statusCode,
        ).toBe(200);
        const stale = await server.app.inject({
          method: "POST",
          url: `/api/packs/${id}/moderate`,
          headers: { cookie: adminCookie },
          payload: { status: "approved", revision: 1 },
        });
        expect(stale.statusCode).toBe(400);
        expect((await independent.get(id))?.status).toBe("pending");
        expect(
          (
            await server.app.inject({
              method: "POST",
              url: `/api/packs/${id}/moderate`,
              headers: { cookie: adminCookie },
              payload: { status: "approved", revision: 2 },
            })
          ).statusCode,
        ).toBe(200);
        const approved = (
          await server.app.inject({
            url: "/api/library",
            headers: { cookie: adminCookie },
          })
        ).json<Library>();
        expect(approved.catalog.some((p) => p.id === id)).toBe(true);
        expect(
          (
            await server.app.inject({
              url: `/api/packs/${id}`,
              headers: { cookie: adminCookie },
            })
          ).json(),
        ).toEqual(updated);
        await server.app.inject({
          method: "PUT",
          url: `/api/packs/${id}`,
          headers: { cookie: ownerCookie },
          payload: { ...updated, description: "Nouvelle modification" },
        });
        expect((await independent.get(id))?.status).toBe("pending");
        const deleted = await server.app.inject({
          method: "DELETE",
          url: "/api/auth/me",
          headers: { cookie: ownerCookie },
        });
        expect(deleted.statusCode).toBe(200);
        expect(await independent.get(id)).toBeNull();
        expect(await independent.get(preset.json().id)).toBeNull();
      } finally {
        await server.app.close();
        await db.libraryItem.deleteMany({ where: { id: { in: ids } } });
        await db.user.deleteMany({
          where: { email: { in: [email, ownerEmail] } },
        });
        await db.$disconnect();
      }
    });
  },
);
