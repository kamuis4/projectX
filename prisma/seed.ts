import { PrismaClient } from "@prisma/client";
import words from "../data/words.fr.json";
const db = new PrismaClient();
try {
  for (const word of words) {
    const data = {
      id: word.id,
      categoryId: word.category,
      label: word.label,
      difficulty: word.difficulty,
      locale: word.locale,
      enabled: word.enabled,
    };
    await db.word.upsert({
      where: { id: word.id },
      create: data,
      update: data,
    });
  }
  console.log(`${words.length} mots chargés.`);
} finally {
  await db.$disconnect();
}
