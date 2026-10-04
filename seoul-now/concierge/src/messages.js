// 사용자에게 보이는 공통 안내 문구(Worker·아티팩트 공용).
export const MSG = {
  ko: { error: "일시적으로 답변할 수 없습니다. 잠시 후 다시 시도하거나 관광통역안내 1330으로 문의해 주세요.",
    rate: "요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.", blocked: "그 요청에는 답할 수 없습니다. 여행 관련 질문을 도와드릴게요.",
    emergency: "긴급 상황이면 112(경찰), 119(화재·구급), 1330(관광통역안내)으로 바로 연락하세요.", too_long: "메시지는 1,000자 이내로 입력해 주세요." },
  en: { error: "Sorry, I can't answer right now. Please try again shortly or call the 1330 Korea Travel Hotline.",
    rate: "Too many requests. Please try again in a minute.", blocked: "I can't help with that request, but I'm happy to help with your trip.",
    emergency: "In an emergency call 112 (police), 119 (fire/ambulance) or 1330 (interpretation) right away.", too_long: "Please keep messages under 1,000 characters." },
  ja: { error: "現在お答えできません。しばらくしてから再度お試しいただくか、観光通訳案内1330へお問い合わせください。",
    rate: "リクエストが多すぎます。1分後にもう一度お試しください。", blocked: "そのご依頼にはお答えできません。旅行のご質問ならお手伝いします。",
    emergency: "緊急時は112（警察）、119（消防・救急）、1330（通訳案内）へすぐにご連絡ください。", too_long: "メッセージは1,000文字以内で入力してください。" },
  "zh-CN": { error: "暂时无法回答。请稍后再试，或拨打旅游翻译热线1330。", rate: "请求过多，请一分钟后再试。",
    blocked: "无法回答该请求。我可以帮您解答旅行相关问题。", emergency: "如遇紧急情况，请立即拨打112（警察）、119（消防/急救）或1330（翻译）。", too_long: "消息请控制在1000字以内。" },
  "zh-TW": { error: "暫時無法回答。請稍後再試，或撥打觀光翻譯熱線1330。", rate: "請求過多，請一分鐘後再試。",
    blocked: "無法回答該請求。我可以協助您解答旅遊相關問題。", emergency: "如遇緊急狀況，請立即撥打112（警察）、119（消防/救護）或1330（翻譯）。", too_long: "訊息請控制在1000字以內。" },
};
export const msg = (lang, key) => (MSG[lang] || MSG.en)[key];
