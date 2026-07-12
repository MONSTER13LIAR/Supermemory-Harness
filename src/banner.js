export function cliBanner(subtitle = "") {
  const lines = [
    "  ___ _ __ ___   ___| |_| |",
    " / __| '_ ` _ \\ / __| __| |",
    " \\__ \\ | | | | | (__| |_| |",
    " |___/_| |_| |_|\\___|\\__|_|",
    "",
    " Supermemory Harness"
  ];
  if (subtitle) {
    lines.push(` ${subtitle}`);
  }
  return lines.join("\n");
}
