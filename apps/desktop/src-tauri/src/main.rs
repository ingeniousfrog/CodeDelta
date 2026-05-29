// Prevents additional console window on Windows in release, unused on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    codedelta_desktop_lib::run();
}
