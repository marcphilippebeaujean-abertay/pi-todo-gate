#!/usr/bin/env bash
set -eu

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

if [ "${1:-}" = "configure" ]; then
  if [ "$#" -ne 3 ] || [ -z "$2" ] || [ -z "$3" ]; then
    printf 'usage: %s configure <coding-root> <todoist-project-ref>\n' "$0" >&2
    exit 2
  fi
  config_path="$agent_dir/pi-todo-gate.json"
  python3 - "$config_path" "$2" "$3" <<'PY'
import json
import os
import sys
import tempfile

path, coding_root, project_ref = sys.argv[1:]
os.makedirs(os.path.dirname(path), exist_ok=True)
try:
    with open(path, encoding="utf-8") as handle:
        config = json.load(handle)
except FileNotFoundError:
    config = {}
except json.JSONDecodeError as error:
    raise SystemExit(f"cannot update malformed configuration: {error}")
if not isinstance(config, dict):
    raise SystemExit("cannot update malformed configuration: expected an object")
projects = config.setdefault("projects", {})
if not isinstance(projects, dict):
    raise SystemExit("cannot update malformed configuration: projects must be an object")
existing = projects.get(coding_root)
if isinstance(existing, dict) and isinstance(existing.get("todoistProjectRef"), str):
    existing["todoistProjectRef"] = project_ref
else:
    projects[coding_root] = project_ref
fd, temporary = tempfile.mkstemp(prefix="pi-todo-gate-", dir=os.path.dirname(path), text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=2)
        handle.write("\n")
    os.replace(temporary, path)
except BaseException:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    raise
PY
  exit 0
fi

force=false
if [ "$#" -gt 1 ]; then
  printf 'usage: %s [--force]\n' "$0" >&2
  exit 2
elif [ "${1:-}" = "--force" ]; then
  force=true
elif [ "$#" -eq 1 ]; then
  printf 'usage: %s [--force]\n' "$0" >&2
  exit 2
fi

source_dir="$repo_dir/extensions"
source_path="$source_dir/index.ts"
target_path="$agent_dir/extensions/pi-todo-gate"
legacy_file_path="$agent_dir/extensions/pi-todo-gate.ts"
legacy_target_path="$agent_dir/extensions/pi-todo-gate"
legacy_herdr_gate_path="$agent_dir/extensions/herdr-claim-gate.ts"
legacy_herdr_test_path="$agent_dir/extensions/tests/herdr-claim-gate.test.ts"
if [ ! -f "$source_path" ]; then
  printf 'missing extension source: %s\n' "$source_path" >&2
  exit 1
fi
mkdir -p "$(dirname -- "$target_path")"
for legacy_path in "$legacy_herdr_gate_path" "$legacy_herdr_test_path"; do
  if [ -f "$legacy_path" ] || [ -L "$legacy_path" ]; then
    rm -- "$legacy_path"
    printf 'removed legacy file %s\n' "$legacy_path"
  fi
done
if [ -L "$legacy_file_path" ] && [ "$(readlink "$legacy_file_path")" = "$repo_dir/extensions/pi-todo-gate.ts" ]; then
  rm -- "$legacy_file_path"
fi
if [ -L "$legacy_target_path" ] && [ "$(readlink "$legacy_target_path")" = "$repo_dir/extensions/pi-todo-gate.ts" ]; then
  rm -- "$legacy_target_path"
fi
if [ -e "$target_path" ] || [ -L "$target_path" ]; then
  if [ ! -L "$target_path" ] && [ "$force" = false ]; then
    printf 'refusing to replace non-symlink: %s (use --force)\n' "$target_path" >&2
    exit 1
  fi
  rm -rf -- "$target_path"
fi
ln -s "$source_dir" "$target_path"
printf 'installed %s -> %s\n' "$target_path" "$source_dir"
