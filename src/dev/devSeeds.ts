import type { ChatMessage } from "@/types"

/**
 * Fake chat messages for dev mode (?dev=1).
 * Covers all bubble types: resident incoming, player outgoing, system pill.
 * Spread across ticks to simulate a realistic conversation timeline.
 */
export const DEV_SEED_MESSAGES: ChatMessage[] = [
  {
    id: "dev_sys_1",
    senderId: "system",
    senderName: "מערכת",
    content: "ברוכים הבאים לקבוצת הוואטסאפ של בניין גולדה 14",
    tick: 0,
    type: "system",
  },
  {
    id: "dev_dov_1",
    senderId: "dov_5a",
    senderName: "דב מזרחי",
    content: "מי עשה את הרעש הזה אמש בשתיים בלילה?? לא יאמן. אנשים ישנים!!",
    tick: 5,
    type: "resident",
  },
  {
    id: "dev_rivka_1",
    senderId: "rivka_3b",
    senderName: "רבקה כהן",
    content: "גם אני שמעתי! שכנים אמרו לי שזה מהדירה בקומה שלישית... לא אומרת שמות 🤐",
    tick: 8,
    type: "resident",
  },
  {
    id: "dev_player_1",
    senderId: "player",
    senderName: "אתה",
    content: "שלום לכולם, אני מטפל בעניין. אבדוק מה קרה ואחזור אליכם",
    tick: 12,
    type: "player",
  },
  {
    id: "dev_shmuel_1",
    senderId: "shmuel_1a",
    senderName: "שמואל לוי",
    content: "תודה שאתה מגיב מהר 👍 בטוח יש הסבר הגיוני לכל זה",
    tick: 14,
    type: "resident",
  },
  {
    id: "dev_dov_2",
    senderId: "dov_5a",
    senderName: "דב מזרחי",
    content: "הסבר הגיוני?? כבר חמש שנים שאני גר כאן ולא ישנתי טוב אף פעם!!",
    tick: 18,
    type: "resident",
  },
  {
    id: "dev_miriam_1",
    senderId: "miriam_2d",
    senderName: "מרים פרץ",
    content: "אני רוצה לדעת מה ועד הבית עושה בכלל עם דמי הוועד שלנו. היכן הדו\"ח?",
    tick: 22,
    type: "resident",
  },
  {
    id: "dev_sys_2",
    senderId: "system",
    senderName: "מערכת",
    content: "יוסי אזולאי הצטרף לקבוצה",
    tick: 25,
    type: "system",
  },
  {
    id: "dev_yossi_1",
    senderId: "yossi_6b",
    senderName: "יוסי אזולאי",
    content: "מה פה קורה?? עכשיו ראיתי שמישהו חנה במקום שלי שוב!! מי זה היה??",
    tick: 27,
    type: "resident",
  },
  {
    id: "dev_player_2",
    senderId: "player",
    senderName: "אתה",
    content: "יוסי, אגיע לבדוק את זה עכשיו. מרים, אשלח דו\"ח מסודר עד סוף השבוע",
    tick: 30,
    type: "player",
  },
]

/**
 * A smaller batch injected when the dev "inject messages" button is clicked.
 * Simulates a new burst of resident activity so scroll + append behavior is testable.
 * @param baseId - unique prefix to avoid key collisions across multiple injections
 * @param baseTick - tick to start from (so timestamps look sequential)
 */
export function makeDevInjectBatch(baseId: string, baseTick: number): ChatMessage[] {
  return [
    {
      id: `${baseId}_noa_1`,
      senderId: "noa_4c",
      senderName: "נועה ותל שפירו",
      content: "היי לכולם 😊 אנחנו חדשים בבניין ונשמח להכיר! אפשר לדעת מתי יש אסיפת ועד?",
      tick: baseTick,
      type: "resident",
    },
    {
      id: `${baseId}_rivka_2`,
      senderId: "rivka_3b",
      senderName: "רבקה כהן",
      content: "ברוכים הבאים!! 🎉 אספר לכם כל מה שצריך לדעת על הבניין בפרטי 😏",
      tick: baseTick + 3,
      type: "resident",
    },
    {
      id: `${baseId}_dov_3`,
      senderId: "dov_5a",
      senderName: "דב מזרחי",
      content: "מתי תהיה אסיפה?? כבר חודשיים שאני מחכה. זה לא מקובל!!",
      tick: baseTick + 6,
      type: "resident",
    },
  ]
}
