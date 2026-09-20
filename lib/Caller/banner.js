/**
 * Chama Baileys Caller — Custom Colored Welcome Banner
 * @author Chama (@chamanemax02)
 */

export function printChamaBanner(botInfo = {}) {
  const c = {
    cyan: "\x1b[1;38;5;51m",
    sky: "\x1b[38;5;45m",
    blue: "\x1b[38;5;39m",
    gold: "\x1b[1;38;5;220m",
    pink: "\x1b[1;38;5;213m",
    magenta: "\x1b[1;38;5;198m",
    green: "\x1b[1;38;5;82m",
    purple: "\x1b[38;5;141m",
    white: "\x1b[1;37m",
    dim: "\x1b[2m",
    reset: "\x1b[0m",
  };

  const rawInfo = typeof botInfo === "string" ? botInfo : (botInfo?.id || botInfo?.name || "");
  const cleanNumber = rawInfo ? rawInfo.split("@")[0].split(":")[0] : "Ready";

  console.log(`
${c.cyan}  ██████╗██╗  ██╗ █████╗ ███╗   ███╗ █████╗ 
${c.sky} ██╔════╝██║  ██║██╔══██╗████╗ ████║██╔══██╗
${c.blue} ██║     ███████║███████║██╔████╔██║███████║
${c.purple} ██║     ██╔══██║██╔══██║██║╚██╔╝██║██╔══██║
${c.magenta} ╚██████╗██║  ██║██║  ██║██║ ╚═╝ ██║██║  ██║
${c.pink}  ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝${c.reset}

${c.cyan}╔══════════════════════════════════════════════════════════════════════════╗
║${c.gold}               ⚡ CHAMA BAILEYS CALL ENGINE v2.0 ⚡                       ${c.cyan}║
║${c.dim}   ────────────────────────────────────────────────────────────────────   ${c.cyan}║
║   ${c.pink}👑 Author    : ${c.white}CHAMA (@chamanemax02)                                  ${c.cyan}║
║   ${c.purple}🚀 Engine    : ${c.white}WhatsApp VoIP Native WebRTC Audio Engine                ${c.cyan}║
║   ${c.green}🟢 Connected : ${c.white}+${cleanNumber.padEnd(54)} ${c.cyan}║
║   ${c.gold}📞 Auto-Call : ${c.white}READY — Listening for incoming WhatsApp voice calls!   ${c.cyan}║
╚══════════════════════════════════════════════════════════════════════════╝${c.reset}
`);
}
