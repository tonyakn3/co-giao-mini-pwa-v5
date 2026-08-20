# Cô Giáo Mini PWA v5

Bản mới nhất chạy trực tiếp trên Safari iPhone/iPad và có thể **Add to Home Screen**.

## Điểm mới
- Gemini 3.1 Flash Live Preview.
- Chờ `setupComplete` trước khi gửi audio.
- Session resumption + tự reconnect khi Live socket sắp/đã đóng.
- Context window compression.
- VAD dành cho trẻ nhỏ: chờ khoảng 900 ms im lặng trước khi coi là hết lượt.
- Mindset **Minimum Helpful Turn**: nói vừa đủ, giải thích vừa đủ.
- **Short Repair Loop**: hiểu ý → sửa 1 điểm → mẫu đúng → nói lại 1 lần nếu cần → đi tiếp.
- Không sửa mọi lỗi, không biến hội thoại thành quiz, không khen máy móc.
- Tốc độ playback chỉnh **50–100%**, mặc định **80%**.
- Memory local được giới hạn khi đưa vào system prompt.
- Service worker v5 dùng network-first để bản GitHub Pages mới cập nhật dễ hơn.

## Deploy GitHub Pages
1. Giải nén ZIP.
2. Upload **toàn bộ file bên trong** vào root repo `co-giao-mini-pwa`, thay file cũ.
3. GitHub → Settings → Pages.
4. Source: **Deploy from a branch**.
5. Branch: `main`, folder: `/(root)`.
6. Chờ Pages deploy.
7. Trên iPhone/iPad mở link bằng Safari.
8. Nếu đã Add to Home Screen bản cũ, đóng app rồi mở lại. Nếu vẫn cache cũ, xóa icon Home Screen và Add to Home Screen lại một lần.

## API key
API key không nằm trong source GitHub. Key được nhập trên thiết bị. Nếu chọn “Nhớ”, key nằm trong localStorage của Safari/PWA.

> Với app cá nhân thì cách này tiện. Nếu phát cho nhiều người, nên dùng backend riêng để giữ API key và chỉ cấp ephemeral token cho client.

## Lưu ý tốc độ giọng trên Safari
PWA nhận PCM realtime từ Gemini và điều chỉnh tốc độ playback bằng Web Audio. Ở mức rất chậm (đặc biệt 50–60%), cao độ có thể thấp hơn một chút. Prompt cũng yêu cầu Mini nói chậm, rõ và dùng câu ngắn để giảm nhu cầu kéo playback quá thấp.
