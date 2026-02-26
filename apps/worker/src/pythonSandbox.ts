import { mkdtemp, rm, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

type SandboxSuccess = {
  ok: true;
  result: unknown;
  stdout: string;
  stderr: string;
  durationMs: number;
};

type SandboxFailure = {
  ok: false;
  error: string;
  stdout: string;
  stderr: string;
  traceback?: string;
  durationMs: number;
};

export type SandboxExecutionResult = SandboxSuccess | SandboxFailure;

const RUNNER_CODE = String.raw`#!/usr/bin/env python3
import builtins
import io
import json
import resource
import signal
import socket
import sys
import traceback

MAX_OUTPUT_CHARS = 12000

BLOCKED_MODULE_PREFIXES = (
    "subprocess",
    "socket",
    "ctypes",
    "multiprocessing",
    "ssl",
    "http",
    "urllib",
    "ftplib",
    "telnetlib",
    "asyncio",
)

def guard_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = (name or "").split(".")[0]
    if root in BLOCKED_MODULE_PREFIXES:
        raise ImportError(f"Module '{root}' is blocked in sandbox")
    return ORIGINAL_IMPORT(name, globals, locals, fromlist, level)

def disable_network():
    def blocked(*args, **kwargs):
        raise RuntimeError("Network is disabled in sandbox")
    socket.socket = blocked
    socket.create_connection = blocked

def apply_limits(timeout_ms, memory_mb):
    timeout_sec = max(1, int(timeout_ms / 1000) + 1)
    mem_bytes = max(64, memory_mb) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_CPU, (timeout_sec, timeout_sec))
    resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
    resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
    signal.alarm(timeout_sec + 1)

def build_safe_builtins():
    allowed = [
        "__build_class__", "__import__", "abs", "all", "any", "bin", "bool", "bytes",
        "callable", "chr", "dict", "dir", "divmod", "enumerate", "filter", "float",
        "format", "frozenset", "hash", "hex", "int", "isinstance", "issubclass",
        "iter", "len", "list", "map", "max", "min", "next", "object", "oct", "ord",
        "pow", "print", "range", "repr", "reversed", "round", "set", "slice", "sorted",
        "str", "sum", "tuple", "type", "zip", "Exception", "ValueError", "TypeError",
        "KeyError", "IndexError", "RuntimeError", "ArithmeticError"
    ]
    safe = {}
    for name in allowed:
        safe[name] = getattr(builtins, name)

    def blocked_open(*args, **kwargs):
        raise PermissionError("open() is disabled in sandbox")

    safe["open"] = blocked_open
    return safe

def stringify_payload(payload):
    try:
        return json.dumps(payload, ensure_ascii=False)
    except Exception:
        fallback = dict(payload)
        fallback["result"] = str(payload.get("result"))
        return json.dumps(fallback, ensure_ascii=False)

def main():
    if len(sys.argv) < 5:
        sys.__stdout__.write(json.dumps({"ok": False, "error": "Missing runner args"}))
        return

    script_path = sys.argv[1]
    input_path = sys.argv[2]
    timeout_ms = int(sys.argv[3])
    memory_mb = int(sys.argv[4])

    with open(script_path, "r", encoding="utf-8") as f:
        code = f.read()

    with open(input_path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
        input_data = json.loads(raw) if raw else {}

    apply_limits(timeout_ms, memory_mb)
    disable_network()

    global ORIGINAL_IMPORT
    ORIGINAL_IMPORT = builtins.__import__
    builtins.__import__ = guard_import

    output_buffer = io.StringIO()
    error_buffer = io.StringIO()
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    sys.stdout = output_buffer
    sys.stderr = error_buffer

    scope = {
        "__builtins__": build_safe_builtins(),
        "TOOL_INPUT": input_data,
        "TOOL_OUTPUT": None,
    }

    try:
        exec(compile(code, "user_script.py", "exec"), scope, scope)
        result = scope.get("TOOL_OUTPUT")
        if result is None and callable(scope.get("main")):
            result = scope["main"](input_data)
        payload = {
            "ok": True,
            "result": result,
            "stdout": output_buffer.getvalue()[:MAX_OUTPUT_CHARS],
            "stderr": error_buffer.getvalue()[:MAX_OUTPUT_CHARS],
        }
    except Exception as e:
        payload = {
            "ok": False,
            "error": str(e),
            "traceback": traceback.format_exc()[:MAX_OUTPUT_CHARS],
            "stdout": output_buffer.getvalue()[:MAX_OUTPUT_CHARS],
            "stderr": error_buffer.getvalue()[:MAX_OUTPUT_CHARS],
        }
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    sys.__stdout__.write(stringify_payload(payload))

if __name__ == "__main__":
    main()
`;

type ExecutePythonOptions = {
  code: string;
  input: Record<string, unknown>;
  timeoutMs: number;
  memoryLimitMb: number;
};

export async function executePythonInSandbox(
  options: ExecutePythonOptions
): Promise<SandboxExecutionResult> {
  const pythonBin = (process.env.PYTHON_BIN ?? 'python3').trim() || 'python3';
  const timeoutMs = Math.min(60_000, Math.max(1_000, Math.floor(options.timeoutMs || 10_000)));
  const memoryLimitMb = Math.min(1_024, Math.max(64, Math.floor(options.memoryLimitMb || 256)));
  const start = Date.now();
  const dir = await mkdtemp(join(tmpdir(), 'notebookgo-py-'));
  const scriptPath = join(dir, 'script.py');
  const inputPath = join(dir, 'input.json');
  const runnerPath = join(dir, 'runner.py');

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  try {
    await writeFile(scriptPath, options.code, 'utf-8');
    await writeFile(inputPath, JSON.stringify(options.input ?? {}), 'utf-8');
    await writeFile(runnerPath, RUNNER_CODE, 'utf-8');

    const child = spawn(
      pythonBin,
      ['-I', runnerPath, scriptPath, inputPath, String(timeoutMs), String(memoryLimitMb)],
      {
        cwd: dir,
        env: { PYTHONUTF8: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    const maxStream = 24_000;
    child.stdout.on('data', (chunk) => {
      if (stdout.length >= maxStream) return;
      stdout += String(chunk);
      if (stdout.length > maxStream) stdout = stdout.slice(0, maxStream);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length >= maxStream) return;
      stderr += String(chunk);
      if (stderr.length > maxStream) stderr = stderr.slice(0, maxStream);
    });

    const exitInfo = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs + 500);

      child.on('error', () => {
        clearTimeout(timer);
        resolve({ code: -1, signal: null });
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });

    const durationMs = Date.now() - start;
    if (timedOut) {
      return {
        ok: false,
        error: `Execution timed out after ${timeoutMs}ms`,
        stdout,
        stderr,
        durationMs,
      };
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    if (!parsed) {
      const baseError =
        exitInfo.code === -1
          ? `Python runtime not available. Please install python3 and set PYTHON_BIN if needed.`
          : `Sandbox execution failed (exit=${exitInfo.code ?? 'null'}, signal=${exitInfo.signal ?? 'null'})`;
      return {
        ok: false,
        error: baseError,
        stdout,
        stderr,
        durationMs,
      };
    }

    if (parsed.ok) {
      return {
        ok: true,
        result: parsed.result,
        stdout: String(parsed.stdout ?? ''),
        stderr: String(parsed.stderr ?? ''),
        durationMs,
      };
    }

    return {
      ok: false,
      error: String(parsed.error ?? 'Execution failed'),
      traceback: parsed.traceback ? String(parsed.traceback) : undefined,
      stdout: String(parsed.stdout ?? ''),
      stderr: String(parsed.stderr ?? ''),
      durationMs,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
