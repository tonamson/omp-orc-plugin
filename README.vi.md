# Hướng dẫn OMP ORC Plugin

Plugin biến model đang chọn trong terminal [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) thành **Supervisor**. Supervisor có thể giao một việc chuyên môn cho Claude Code CLI, Codex CLI hoặc một model khác đã có trong OMP, nhận kết quả rồi tự kiểm chứng và trả lời bạn trong cùng terminal.

Plugin **không yêu cầu B.AI hoặc DeepSeek** để làm Supervisor. Nó cũng không tự cài provider, không đăng nhập hộ Claude/Codex và không đọc token tài khoản của hai CLI đó.

## 1. Điều kiện cần

| Thành phần | Khi nào cần | Kiểm tra |
| --- | --- | --- |
| OMP | Luôn cần; đã kiểm tra với bản 18.3.1 | `omp --version` |
| Một model đã đăng nhập trong OMP | Luôn cần để chạy Supervisor | `omp models` |
| Git, Node.js và npm | Cần để lấy mã nguồn và chạy `npm ci`; đã kiểm tra với Node.js 24 | `git --version`, `node --version`, `npm --version` |
| Claude Code CLI | Chỉ cần khi giao việc qua `claude-cli` | `claude --version`, `claude auth status` |
| Codex CLI | Chỉ cần khi giao việc qua `codex-cli` | `codex --version`, `codex login status` |

Không cần cài cả Claude và Codex nếu bạn chỉ dùng một CLI, hoặc chỉ dùng specialist qua model có sẵn trong OMP. Model của Supervisor phải hỗ trợ gọi tool để sử dụng `orc_dispatch`.

Nếu chưa có OMP, cài theo [hướng dẫn chính thức](https://github.com/can1357/oh-my-pi#install). Trên macOS/Linux, dự án OMP hiện hướng dẫn:

```sh
curl -fsSL https://omp.sh/install | sh
omp --version
```

Đăng nhập provider mà bạn muốn dùng trong OMP. Nếu dùng auth broker của OMP, có thể chọn provider bằng `omp auth-broker login`. Sau đó chạy `omp models` để kiểm tra danh sách model. Trong phiên OMP, dùng `/model` để chọn model chính. **Model chính được chọn ở đây là Supervisor**; plugin không đổi model này.

## 2. Cài plugin

Lấy mã nguồn và cài dependency theo lockfile:

```sh
git clone https://github.com/tonamson/omp-orc-plugin.git
cd omp-orc-plugin
npm ci
```

Để OMP tự nạp plugin mỗi lần mở terminal, chạy ngay trong thư mục vừa clone:

```sh
omp plugin link .
omp plugin list
```

`omp plugin list` giúp kiểm tra plugin đã được liên kết. Sau đó mở **thư mục dự án bạn muốn làm việc** và chạy `omp` như bình thường. Plugin đăng ký tool `orc_dispatch` và thêm hướng dẫn Supervisor vào phiên OMP.

Nếu chỉ muốn thử một lần mà chưa liên kết plugin, dùng đường dẫn tuyệt đối:

```sh
omp --plugin-dir /duong/dan/tuyet/doi/omp-orc-plugin
```

Không cần vừa `plugin link` vừa truyền `--plugin-dir` cho cùng một phiên.

## 3. Chuẩn bị specialist

### Claude Code CLI

Chỉ làm bước này nếu muốn dùng Claude làm specialist. Cài [Claude Code CLI](https://github.com/anthropics/claude-code#readme), rồi đăng nhập bằng CLI chính thức:

```sh
claude auth login
claude auth status
```

Plugin gọi lệnh `claude` đã có trên máy. Tài khoản, phiên đăng nhập và quota vẫn do Claude CLI quản lý.

### Codex CLI

Chỉ làm bước này nếu muốn dùng Codex làm specialist. Cài [Codex CLI](https://github.com/openai/codex#readme), rồi đăng nhập bằng CLI chính thức:

```sh
codex login
codex login status
```

Plugin gọi lệnh `codex` đã có trên máy. Tài khoản, phiên đăng nhập và quota vẫn do Codex CLI quản lý.

### Model khác trong OMP

Nếu muốn dùng một provider/model đã cấu hình trong OMP làm specialist, kiểm tra tên model bằng `omp models`. Khi giao việc, chỉ định `runtime: omp-model` và tên đầy đủ dạng `provider/model` đang có trong danh sách. Ví dụ `deepseek/ten-model` chỉ là mẫu; hãy thay bằng ID thực tế của bạn. Nếu không chỉ định model riêng, adapter sẽ dùng model được cấu hình cho role hoặc model hiện tại của OMP.

## 4. Sử dụng trong một terminal OMP

Mở OMP ở thư mục dự án, chọn model chính bằng `/model`, rồi yêu cầu bằng ngôn ngữ tự nhiên. Bạn có thể nêu rõ CLI hoặc model muốn dùng; Supervisor phải giữ lựa chọn đó khi gọi `orc_dispatch`.

**Xin tư vấn kiến trúc từ Claude:**

```text
Bạn là Supervisor. Hãy gọi role architect qua claude-cli để đề xuất hai cách chia module này. Chỉ đọc mã nguồn. Sau đó tự đánh giá ưu nhược điểm và đưa ra phương án cuối.
```

**Review thay đổi bằng Codex:**

```text
Hãy review git diff hiện tại qua codex-cli với role reviewer, quyền read. Kiểm chứng từng nhận xét trước khi báo lỗi cho tôi.
```

**Audit bảo mật bằng model đã có trong OMP:**

```text
Hãy gọi role security-reviewer với runtime omp-model, model provider/model-id của tôi, quyền read, để audit thay đổi về xác thực. Sau đó tự xác minh từng finding.
```

Thay `provider/model-id` bằng ID xuất hiện trong `omp models`. Nếu không ghi rõ runtime, role `architect` mặc định đi qua Claude CLI; `reviewer` và `security-reviewer` mặc định đi qua Codex CLI. Các giá trị runtime hiện có là `auto`, `claude-cli`, `codex-cli`, `omp-model`. V1 có đúng ba role trên.

Supervisor quyết định có cần gọi specialist hay không. Với việc đơn giản, nó có thể xử lý trực tiếp. Kết quả specialist là ý kiến tư vấn; Supervisor chịu trách nhiệm kiểm chứng, sửa code, chạy kiểm tra và trả lời cuối.

## 5. Quyền truy cập và giới hạn V1

- Specialist mặc định **chỉ đọc**. Claude bị giới hạn ở `Read`, `Grep`, `Glob`; Codex chạy trong sandbox `read-only`; OMP model chỉ nhận các tool `read`, `grep`, `glob`.
- Nếu muốn specialist sửa code, hãy yêu cầu Supervisor gọi `orc_dispatch` với `permission: write` và chọn **Claude CLI hoặc Codex CLI**. Sau khi specialist trả kết quả, Supervisor cần xem file đã đổi và chạy lại kiểm tra phù hợp.
- `omp-model` với `permission: write` hiện bị từ chối vì chưa có ranh giới ghi an toàn được xác nhận.
- Mỗi lần chỉ chạy một specialist. Plugin không tự chuyển sang runtime khác nếu CLI hoặc model được chỉ định gặp lỗi.
- V1 chưa đăng ký provider B.AI, chưa lưu phiên specialist, chưa chạy song song và chưa tạo worktree riêng cho worker.

## 6. Kiểm tra và xử lý lỗi

| Hiện tượng / mã lỗi | Việc cần làm |
| --- | --- |
| OMP báo không có model | Đăng nhập/cấu hình ít nhất một provider trong OMP; kiểm tra `omp models` và chọn model chính bằng `/model`. |
| `CLI_NOT_FOUND` | Cài CLI tương ứng; kiểm tra `claude --version` hoặc `codex --version` trong cùng môi trường chạy OMP. |
| `AUTH_REQUIRED` | Đăng nhập lại bằng `claude auth login` hoặc `codex login`; kiểm tra trạng thái bằng lệnh `status` tương ứng. |
| `MODEL_UNAVAILABLE` | Dùng đúng ID `provider/model` xuất hiện trong `omp models`, hoặc kiểm tra tên model mà CLI hỗ trợ. |
| `INVALID_REQUEST` khi yêu cầu `omp-model` ghi file | Chuyển sang Claude/Codex CLI với `permission: write`, hoặc để Supervisor tự sửa. |
| `BUSY` | Đợi specialist hiện tại hoàn tất rồi giao việc tiếp. |
| `RATE_LIMIT`, `QUOTA_EXHAUSTED` | Kiểm tra quota của provider hoặc tài khoản CLI tương ứng. |
| `PROCESS_TIMEOUT` | Chia việc nhỏ hơn và chạy lại. Một lượt specialist có giới hạn thời gian năm phút. |

Để kiểm tra code plugin mà không dùng quota model:

```sh
npm test
npm run typecheck
```

Hai lệnh này chỉ chạy test và TypeScript ở máy local. Chúng không thay thế việc thử một lượt OMP thực tế với model và CLI đã đăng nhập.

## Nguồn lệnh cài đặt

- [OMP: cài đặt và plugin](https://github.com/can1357/oh-my-pi#install)
- [Claude Code CLI](https://github.com/anthropics/claude-code#readme)
- [Codex CLI](https://github.com/openai/codex#readme)
