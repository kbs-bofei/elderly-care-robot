// time.mjs — 把当前本地日期与时间，连同老人听得懂的口语说法，附到每条 prompt 后面。
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const WEEK = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const CN = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const cn = (n) =>
  n < 10 ? CN[n] : n < 20 ? "十" + (n % 10 ? CN[n % 10] : "") : CN[Math.floor(n / 10)] + "十" + (n % 10 ? CN[n % 10] : "");
const period = (h) =>
  h < 5 ? "凌晨" : h < 8 ? "早上" : h < 11 ? "上午" : h < 13 ? "中午" : h < 17 ? "下午" : h < 19 ? "傍晚" : "晚上";

const h = now.getHours();
const m = now.getMinutes();
const h12 = h % 12 === 0 ? 12 : h % 12;
const spoken = `${period(h)}${cn(h12)}点${m === 0 ? "整" : m === 30 ? "半" : cn(m) + "分"}`;

const offset = -now.getTimezoneOffset();
const sign = offset < 0 ? "-" : "+";
const zone = `UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
const stamp = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]} ${pad(h)}:${pad(m)}`;

process.stdout.write(
  JSON.stringify({
    context:
      `当前本地时间：${stamp}（${zone}），口语说法是「${spoken}」。` +
      `跟老人说话时用这个口语说法，不要说数字串；涉及日期时说「今天／明天／后天」加星期几。`,
  }) + "\n",
);
