import type { TaskInput, User } from "./api";
export type QuickResult = { title: string; fields: TaskInput; chips: string[] };
export function parseQuickSyntax(
  raw: string,
  users: [User, User],
): QuickResult {
  const fields: TaskInput = {};
  const chips: string[] = [];
  const tags: string[] = [];
  let title = raw.replace(
    /(^|\s)#([\p{L}\p{N}_-]+)/gu,
    (_, space: string, name: string) => {
      tags.push(name);
      chips.push(`#${name}`);
      return space;
    },
  );
  // Longest names first permits display names containing spaces. Unknown @mentions stay plain text.
  const aliases = [
    { name: "both", ids: users.map((u) => u.id), label: "Both of us" },
    { name: "me", ids: [users[0].id], label: users[0].displayName },
    { name: "teammate", ids: [users[1].id], label: users[1].displayName },
    ...users.flatMap((u) =>
      [u.username, u.displayName].map((name) => ({
        name,
        ids: [u.id],
        label: u.displayName,
      })),
    ),
  ]
    // Reserved relative mentions win even when the signed-in username is "teammate".
    .filter(
      (alias, index, all) =>
        all.findIndex(
          (a) => a.name.toLowerCase() === alias.name.toLowerCase(),
        ) === index,
    )
    .sort((a, b) => b.name.length - a.name.length);
  for (const alias of aliases) {
    const escaped = alias.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(`(^|\\s)@${escaped}(?=\\s|$)`, "gi");
    title = title.replace(expression, (_, space: string) => {
      fields.assignees = alias.ids;
      chips.push(alias.label);
      return space;
    });
  }
  title = title.replace(
    /(^|\s)(!{1,3})(?=\s|$)/g,
    (_, space: string, marks: string) => {
      fields.priority = marks.length as 1 | 2 | 3;
      chips.push(
        ["", "Low priority", "Medium priority", "High priority"][marks.length],
      );
      return space;
    },
  );
  title = title.replace(/(^|\s)\^later(?=\s|$)/gi, (_, space: string) => {
    fields.list = "later";
    chips.push("Later");
    return space;
  });
  if (tags.length) fields.tags = [...new Set(tags)];
  return {
    title: title.replace(/\s+/g, " ").trim(),
    fields,
    chips: [...new Set(chips)],
  };
}
