use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptDiagnostic {
    pub message: String,
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptLintResult {
    pub diagnostics: Vec<ScriptDiagnostic>,
    pub engine: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine_error: Option<String>,
}

pub fn lint_script(language: &str, source: &str) -> ScriptLintResult {
    match language {
        "powershell" => lint_powershell(source),
        "bash" | "shell" => ScriptLintResult {
            diagnostics: lint_shell_structure(source),
            engine: "axis-shell".into(),
            engine_error: None,
        },
        other => ScriptLintResult {
            diagnostics: vec![],
            engine: other.into(),
            engine_error: Some(format!("No syntax checker for {other}.")),
        },
    }
}

fn lint_powershell(source: &str) -> ScriptLintResult {
    match parse_powershell(source) {
        Ok(diagnostics) => ScriptLintResult {
            diagnostics,
            engine: "powershell-parser".into(),
            engine_error: None,
        },
        Err(engine_error) => ScriptLintResult {
            diagnostics: vec![],
            engine: "powershell-parser".into(),
            engine_error: Some(engine_error),
        },
    }
}

fn parse_powershell(source: &str) -> Result<Vec<ScriptDiagnostic>, String> {
    let dir = std::env::temp_dir();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    let source_path = dir.join(format!("axis-lint-{}-{stamp}.ps1", std::process::id()));
    let host_path = dir.join(format!("axis-lint-host-{}-{stamp}.ps1", std::process::id()));
    write_utf8_bom(&source_path, source)?;
    write_utf8_bom(&host_path, POWERSHELL_PARSE_HOST)?;

    let output = (|| {
        let mut command = Command::new("powershell.exe");
        command
            .arg("-NoLogo")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-File")
            .arg(&host_path)
            .arg(&source_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_window(&mut command);
        wait_with_timeout(command, Duration::from_secs(8))
    })();

    let _ = fs::remove_file(&source_path);
    let _ = fs::remove_file(&host_path);
    let output = output?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "PowerShell parser exited {}: {}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        ));
    }
    parse_diagnostics_json(&String::from_utf8_lossy(&output.stdout))
}

const POWERSHELL_PARSE_HOST: &str = r#"
param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)
$rows = @()
foreach ($item in $errors) {
  $rows += [ordered]@{
    message = [string]$item.Message
    startLine = [int]$item.Extent.StartLineNumber
    startColumn = [int]$item.Extent.StartColumnNumber
    endLine = [int]$item.Extent.EndLineNumber
    endColumn = [int]$item.Extent.EndColumnNumber
    severity = 'error'
  }
}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::Out.Write((@($rows) | ConvertTo-Json -Compress))
"#;

fn write_utf8_bom(path: &PathBuf, source: &str) -> Result<(), String> {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(source.as_bytes());
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = command;
}

fn wait_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut stream) = stdout {
            let _ = stream.read_to_end(&mut buf);
        }
        buf
    });
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut stream) = stderr {
            let _ = stream.read_to_end(&mut buf);
        }
        buf
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_handle.join();
                let _ = stderr_handle.join();
                return Err("PowerShell parser timed out.".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(error) => return Err(error.to_string()),
        }
    };
    Ok(std::process::Output {
        status,
        stdout: stdout_handle.join().unwrap_or_default(),
        stderr: stderr_handle.join().unwrap_or_default(),
    })
}

fn parse_diagnostics_json(raw: &str) -> Result<Vec<ScriptDiagnostic>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(vec![]);
    }
    let value: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|error| error.to_string())?;
    let rows = match value {
        serde_json::Value::Array(rows) => rows,
        serde_json::Value::Object(_) => vec![value],
        _ => return Ok(vec![]),
    };
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(ScriptDiagnostic {
                message: row.get("message")?.as_str()?.to_string(),
                start_line: row.get("startLine")?.as_u64()? as u32,
                start_column: row.get("startColumn")?.as_u64()? as u32,
                end_line: row.get("endLine")?.as_u64()? as u32,
                end_column: row.get("endColumn")?.as_u64()? as u32,
                severity: row
                    .get("severity")
                    .and_then(|value| value.as_str())
                    .unwrap_or("error")
                    .to_string(),
            })
        })
        .collect())
}

pub fn lint_shell_structure(source: &str) -> Vec<ScriptDiagnostic> {
    let mut diagnostics = Vec::new();
    let mut stack: Vec<(char, u32, u32)> = Vec::new();
    let mut line = 1u32;
    let mut column = 1u32;
    let mut chars = source.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    while let Some(ch) = chars.next() {
        if ch == '\n' {
            line += 1;
            column = 1;
            escaped = false;
            continue;
        }
        if in_single {
            if ch == '\'' {
                in_single = false;
            }
            column += 1;
            continue;
        }
        if in_double {
            if escaped {
                escaped = false;
                column += 1;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                column += 1;
                continue;
            }
            if ch == '"' {
                in_double = false;
            }
            column += 1;
            continue;
        }
        if ch == '#' {
            while let Some(next) = chars.peek() {
                if *next == '\n' {
                    break;
                }
                chars.next();
            }
            column += 1;
            continue;
        }
        if ch == '\'' {
            in_single = true;
            column += 1;
            continue;
        }
        if ch == '"' {
            in_double = true;
            column += 1;
            continue;
        }
        match ch {
            '(' | '{' | '[' => stack.push((ch, line, column)),
            ')' | '}' | ']' => {
                let expected = match ch {
                    ')' => '(',
                    '}' => '{',
                    _ => '[',
                };
                match stack.pop() {
                    Some((open, ..)) if open == expected => {}
                    Some(_) | None => diagnostics.push(ScriptDiagnostic {
                        message: format!("Unmatched `{ch}`."),
                        start_line: line,
                        start_column: column,
                        end_line: line,
                        end_column: column + 1,
                        severity: "error".into(),
                    }),
                }
            }
            _ => {}
        }
        column += 1;
    }

    if in_single || in_double {
        diagnostics.push(ScriptDiagnostic {
            message: "Unterminated quoted string.".into(),
            start_line: line.max(1),
            start_column: 1,
            end_line: line.max(1),
            end_column: 2,
            severity: "error".into(),
        });
    }
    for (open, open_line, open_col) in stack {
        diagnostics.push(ScriptDiagnostic {
            message: format!("Unclosed `{open}`."),
            start_line: open_line,
            start_column: open_col,
            end_line: open_line,
            end_column: open_col + 1,
            severity: "error".into(),
        });
    }
    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_detects_unclosed_brace() {
        let diagnostics = lint_shell_structure("echo hi {\n");
        assert!(diagnostics.iter().any(|item| item.message.contains("Unclosed")));
    }

    #[test]
    fn shell_ignores_braces_in_quotes() {
        let diagnostics = lint_shell_structure("echo \"{not a block\"\n");
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn shell_detects_unterminated_quote() {
        let diagnostics = lint_shell_structure("echo \"{not a block\n");
        assert!(diagnostics.iter().any(|item| item.message.contains("quoted")));
    }

    #[test]
    fn json_wraps_single_object() {
        let rows = parse_diagnostics_json(
            r#"{"message":"oops","startLine":1,"startColumn":2,"endLine":1,"endColumn":5,"severity":"error"}"#,
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].start_column, 2);
    }
}
