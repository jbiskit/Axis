// Hide the extra cmd window in release; keep a console in debug for eprintln! logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    axis_lib::run()
}
