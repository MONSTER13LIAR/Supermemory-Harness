const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  blue: "\x1b[38;5;33m",
  cyan: "\x1b[38;5;45m",
  deepBlue: "\x1b[38;5;27m",
  dimBlue: "\x1b[38;5;24m"
};

export function cliBanner(subtitle = "", options = {}) {
  const lines = bannerLines(subtitle);
  if (!shouldColor(options)) return lines.join("\n");
  return colorizeBanner(lines).join("\n");
}

export function bannerLines(subtitle = "") {
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
  return lines;
}

function shouldColor(options) {
  if (options.color === true) return true;
  if (options.color === false) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.TERM === "dumb") return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return true;
}

function colorizeBanner(lines) {
  const shades = [ANSI.deepBlue, ANSI.blue, ANSI.cyan, ANSI.blue];
  return lines.map((line, index) => {
    if (index < 4) return `${shades[index]}${line}${ANSI.reset}`;
    if (line.trim() === "") return line;
    if (line.includes("Supermemory Harness")) return `${ANSI.bold}${ANSI.cyan}${line}${ANSI.reset}`;
    return `${ANSI.dimBlue}${line}${ANSI.reset}`;
  });
}
