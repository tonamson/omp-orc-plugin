# OMP ORC Plugin

Use any model selected in [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) as the Supervisor. The Supervisor can request advice from Claude Code CLI, Codex CLI, or another model already configured in OMP, then verify the result in the same terminal.

**[Hướng dẫn cài đặt và sử dụng bằng tiếng Việt](README.vi.md)**

## Quick start

Requires OMP, Node.js and npm, and at least one authenticated OMP model. Claude Code CLI and Codex CLI are optional; install and sign in to each CLI only if you want to use that runtime. This plugin was checked with OMP 18.3.1 and Node.js 24.

```sh
git clone https://github.com/tonamson/omp-orc-plugin.git
cd omp-orc-plugin
npm ci
omp plugin link .
omp plugin list
```

Start `omp` in your project directory and select the Supervisor model with `/model`. For a one-time run without linking, use `omp --plugin-dir /absolute/path/to/omp-orc-plugin`.

The plugin registers the `orc_dispatch` tool. V1 supports the `architect`, `reviewer`, and `security-reviewer` roles, one specialist at a time. Specialists are read-only by default; explicit write delegation is supported through Claude or Codex CLI. See the [Vietnamese guide](README.vi.md) for setup, examples, permissions, and troubleshooting.
