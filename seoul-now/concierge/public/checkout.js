// 목업 결제 화면(시연용). 결제 정보(카드번호 등)를 받는 입력란이 없고, 어떤 결제·예약 요청도 보내지 않는다.
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const T = {
    ko: { stamp: "시연용 – 실제 결제 아님", title: "디스커버 서울 패스 구매 (시연)", payH: "결제 수단",
      payNote: "시연 화면입니다. 결제 정보를 입력받지 않으며 실제로 결제·예약되지 않습니다. 실제 서비스에서는 OK-Seoul 등 공식 결제 화면으로 연결됩니다.",
      confirm: "시연 완료 보기 (결제되지 않음)", done: "시연이 완료되었습니다. 실제 결제·예약은 이루어지지 않았습니다.",
      code: "시연 번호(효력 없음)", back: "← 대화로 돌아가기", price: "가격(샘플)", includes: "포함", notFound: "상품을 찾을 수 없습니다.", sample: "샘플 데이터" },
    en: { stamp: "DEMO – NOT A REAL PAYMENT", title: "Buy Discover Seoul Pass (demo)", payH: "Payment method",
      payNote: "This is a demo screen. No payment details are collected and nothing is charged or booked. A real service would hand off to an official checkout such as OK-Seoul.",
      confirm: "Show demo completion (no charge)", done: "Demo complete. No payment or booking was made.",
      code: "Demo reference (not valid)", back: "← Back to chat", price: "Price (sample)", includes: "Includes", notFound: "Product not found.", sample: "Sample data" },
    ja: { stamp: "デモ用 – 実際の決済ではありません", title: "ディスカバーソウルパス購入（デモ）", payH: "お支払い方法",
      payNote: "デモ画面です。決済情報は入力せず、実際の決済・予約は行われません。実サービスではOK-Seoulなど公式の決済画面へ移動します。",
      confirm: "デモ完了を表示（決済されません）", done: "デモが完了しました。実際の決済・予約は行われていません。",
      code: "デモ番号（無効）", back: "← チャットに戻る", price: "価格（サンプル）", includes: "含まれるもの", notFound: "商品が見つかりません。", sample: "サンプル" },
    "zh-CN": { stamp: "演示用 – 非真实支付", title: "购买首尔通票（演示）", payH: "支付方式",
      payNote: "这是演示页面。不收集支付信息，也不会产生真实扣款或预订。正式服务将跳转至 OK-Seoul 等官方支付页面。",
      confirm: "查看演示完成（不扣款）", done: "演示完成。未进行任何真实支付或预订。",
      code: "演示编号（无效）", back: "← 返回对话", price: "价格（示例）", includes: "包含", notFound: "未找到商品。", sample: "示例数据" },
    "zh-TW": { stamp: "展示用 – 非實際付款", title: "購買首爾通行證（展示）", payH: "付款方式",
      payNote: "這是展示頁面。不收集付款資訊，也不會產生實際扣款或預訂。正式服務將連結至 OK-Seoul 等官方付款頁面。",
      confirm: "查看展示完成（不扣款）", done: "展示完成。未進行任何實際付款或預訂。",
      code: "展示編號（無效）", back: "← 返回對話", price: "價格（範例）", includes: "包含", notFound: "找不到商品。", sample: "範例資料" },
  };
  const params = new URLSearchParams(location.search);
  const lang = Object.hasOwn(T, params.get("lang")) ? params.get("lang") : "ko";
  const t = T[lang];
  const productId = /^[a-z0-9-]{1,30}$/.test(params.get("product") || "") ? params.get("product") : "";

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  }

  document.documentElement.lang = lang;
  $("stamp-title").textContent = t.stamp;
  $("co-title").textContent = t.title;
  $("pay-h").textContent = t.payH;
  $("pay-note").textContent = t.payNote;
  $("confirm").textContent = t.confirm;
  $("back").textContent = t.back;

  async function load() {
    if (!productId) throw new Error("bad id");
    const res = await fetch(`/api/dsp/${productId}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(String(res.status));
    const { product: p } = await res.json();
    $("product").replaceChildren(
      el("div", { class: "card-kind", text: "Discover Seoul Pass" }),
      el("h3", { text: String(p.name || "") }),
      el("div", { class: "badges" }, el("span", { class: "badge sample", text: t.sample })),
      el("p", { class: "price-line", text: `${t.price} ₩${Number(p.price_krw || 0).toLocaleString()} · ${Number(p.duration_hours || 0)}h` }),
      el("p", { text: `${t.includes}: ${(p.includes || []).map((i) => i.name).join(", ")}` }));
  }

  load().catch(() => {
    $("product").replaceChildren(el("p", { text: t.notFound }));
    $("confirm").disabled = true;
  });

  // 결제 요청을 보내지 않는다. 화면에만 시연 완료 표시(새로고침하면 사라짐).
  $("confirm").addEventListener("click", () => {
    const a = new Uint8Array(3);
    crypto.getRandomValues(a);
    const code = `DEMO-${[...a].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    $("result").replaceChildren(el("p", { text: t.done }), el("p", { text: `${t.code}: ${code}` }));
    $("result").hidden = false;
    $("confirm").disabled = true;
  });
})();
