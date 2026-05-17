// 測試用：插入今日 S1 pending tasks 給 preview demo
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TODAY = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

const TASKS = [
  { ward: "3A", initial: "ABC", hnPrefix: "1234", therapistName: "陳 OT", content: "MoCA" },
  { ward: "3B", initial: "DEF", hnPrefix: "5678", therapistName: "陳 OT", content: "AMT + CDT" },
  { ward: "4A", initial: "GHI", hnPrefix: "9999", therapistName: "李 OT", content: "Fit/Check (TED)" },
  { ward: "8E", initial: "JKL", hnPrefix: "1111", therapistName: "李 OT", content: "MoCA evaluation" },
  { ward: "8F", initial: "MNO", hnPrefix: "2222", therapistName: "黃 OT", content: "AMT" },
  { ward: "5E", initial: "PQR", hnPrefix: "3333", therapistName: "黃 OT", content: "Fit (HP)" },
];

async function main() {
  // 清掉今日舊的 S1 pending tasks
  await prisma.assignment.deleteMany({
    where: { date: TODAY, slot: "S1", assistantId: null },
  });

  for (const t of TASKS) {
    const score = /moca/i.test(t.content) ? 2 : 1;
    let cluster: string | null = null;
    if (/[A-D]/i.test(t.ward.slice(-1))) cluster = "CLUSTER_1";
    else if (/[E-H]/i.test(t.ward.slice(-1))) cluster = "CLUSTER_2";

    await prisma.assignment.create({
      data: {
        date: TODAY,
        slot: "S1",
        pool: "S1_INDEPENDENT",
        content: t.content,
        score,
        therapistName: t.therapistName,
        initial: t.initial,
        hnPrefix: t.hnPrefix,
        ward: t.ward,
        cluster,
        assistantId: null,
        wasOverQuota: false,
      },
    });
  }
  console.log(`Inserted ${TASKS.length} pending S1 tasks for ${TODAY.toISOString().slice(0, 10)}`);
}

main().finally(() => prisma.$disconnect());
