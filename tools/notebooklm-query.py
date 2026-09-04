#!/usr/bin/env python3
"""
notebooklm-query.py
-------------------------------------------------------------
指定した固定の指示文を NotebookLM のノートブックに送り、回答を取得して
  data/reports/_notebooklm-answer-YYYYMMDD.md   … 抽出した最新回答
  tools/notebooklm-last-conversation.txt        … 会話の全バブル（保険）
に保存する。ログは tools/notebooklm-query.log。

・NotebookLM スキル（~/.claude/skills/notebooklm）の .venv と
  browser_utils / config を利用する。認証は同スキルのプロファイルを再利用。
・.bat（run-notebooklm-query.bat）経由でスケジュール実行される想定。
・回答生成やファイル整形（aichi-fishing-report-*.md 化）はしない。
  取得した回答は人／Claude Code が確認して使う。

終了コード:
  0 = それらしい回答を取得して保存した
  3 = メッセージを投稿できなかった（入力無効／レート制限の可能性）
  4 = 回答が定型文・拒否・古いバブルのように見える（保存はする）
  1 = 予期しないエラー
"""

import os
import sys
import time
import re
import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = PROJECT_ROOT / "data" / "reports"
LOG_PATH = PROJECT_ROOT / "tools" / "notebooklm-query.log"
CONV_DUMP_PATH = PROJECT_ROOT / "tools" / "notebooklm-last-conversation.txt"

SKILL_DIR = Path(os.path.expanduser("~")) / ".claude" / "skills" / "notebooklm"
sys.path.insert(0, str(SKILL_DIR / "scripts"))

NOTEBOOK_URL = "https://notebook.google.com/notebook/c17d03f8-f77d-4535-9564-e502594abe48"

QUESTION = "上記の調査と同様に、今日の釣果情報を調査して回答してください。"

BAD_HEAD_MARKERS = ["コンテンツを確認しています", "入力を読み込んでいます",
                    "答えられません", "このノートブックには"]
BTN_LINES = {"keep_pin", "メモに保存", "copy_all", "thumb_up", "thumb_down",
             "expand_more", "Thoughts", ""}


def log(msg: str) -> None:
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def clean(text: str) -> str:
    lines = text.splitlines()
    while lines and lines[0].strip() in {"Thoughts", "expand_more", ""}:
        lines.pop(0)
    cut = None
    for i, l in enumerate(lines):
        if l.strip() in {"thumb_up", "thumb_down"}:
            cut = i
    if cut is not None:
        lines = lines[:cut]
        while lines and lines[-1].strip() in BTN_LINES:
            lines.pop()
    return "\n".join(lines).strip()


def main() -> int:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().strftime("%Y%m%d")
    answer_path = REPORTS_DIR / f"_notebooklm-answer-{today}.md"

    log("=== notebooklm-query 開始 ===")
    log(f"質問: {QUESTION}")

    try:
        from patchright.sync_api import sync_playwright
        from browser_utils import BrowserFactory
        from config import QUERY_INPUT_SELECTORS
    except Exception as e:
        log(f"モジュール読込失敗: {e}")
        return 1

    pw = sync_playwright().start()
    ctx = None
    try:
        ctx = BrowserFactory.launch_persistent_context(pw, headless=True)
        page = ctx.new_page()
        page.set_default_timeout(30000)
        page.goto(NOTEBOOK_URL, wait_until="domcontentloaded")
        page.wait_for_url(re.compile(r"^https://notebook(?:lm)?\.google\.com/"), timeout=20000)

        qi = None
        for sel in QUERY_INPUT_SELECTORS:
            try:
                qi = page.wait_for_selector(sel, timeout=15000, state="visible")
                if qi:
                    break
            except Exception:
                continue
        if not qi:
            log("クエリ入力欄が見つかりません（未認証の可能性）")
            return 3
        time.sleep(5)

        def users():
            return page.query_selector_all(".from-user-container")

        def answers():
            return page.query_selector_all(".to-user-container")

        u0, a0 = len(users()), len(answers())
        log(f"開始状態: user={u0} ans={a0}")

        def try_submit():
            ta = page.query_selector(QUERY_INPUT_SELECTORS[0])
            ta.click()
            time.sleep(0.3)
            page.keyboard.press("Control+A")
            page.keyboard.press("Delete")
            page.keyboard.type(QUESTION, delay=5)
            time.sleep(1.0)
            for b in page.query_selector_all("button"):
                lbl = ((b.get_attribute("aria-label") or "") + "|" + (b.inner_text() or "")).lower()
                if ("send" in lbl or "送信" in lbl) and b.is_enabled():
                    b.click()
                    return "button"
            page.keyboard.press("Enter")
            return "enter"

        posted = False
        for attempt in range(1, 4):
            how = try_submit()
            log(f"送信試行 {attempt} ({how})")
            t0 = time.time()
            while time.time() - t0 < 25:
                if len(users()) > u0:
                    posted = True
                    break
                time.sleep(1)
            if posted:
                log(f"  -> 投稿成功 (user={len(users())})")
                break
            log("  -> 投稿確認できず、リトライ")
            time.sleep(4)

        if not posted:
            log("投稿できませんでした（レート制限／会話が詰まっている可能性）")
            _dump_conversation(page)
            return 3

        t0 = time.time()
        while time.time() - t0 < 60:
            if len(answers()) > a0:
                break
            time.sleep(2)

        deadline = time.time() + 420
        last_len = -1
        stable_since = None
        final_raw = None
        while time.time() < deadline:
            time.sleep(3)
            bb = answers()
            if len(bb) <= a0:
                continue
            raw = bb[-1].inner_text()
            done = ("thumb_up" in raw and "thumb_down" in raw)
            transient = ("コンテンツを確認しています" in raw) or ("入力を読み込んでいます" in raw)
            if transient or not done:
                stable_since = None
                last_len = len(raw)
                continue
            if len(raw) == last_len:
                if stable_since is None:
                    stable_since = time.time()
                elif time.time() - stable_since >= 12:
                    final_raw = raw
                    break
            else:
                last_len = len(raw)
                stable_since = None

        _dump_conversation(page)

        if final_raw is None:
            bb = answers()
            final_raw = bb[-1].inner_text() if len(bb) > a0 else ""

        out = clean(final_raw)
        answer_path.write_text(
            f"<!-- NotebookLM 回答  取得: {datetime.datetime.now():%Y-%m-%d %H:%M:%S} -->\n"
            f"<!-- 質問: {QUESTION} -->\n\n" + (out or "(空)"),
            encoding="utf-8",
        )
        log(f"回答を保存: {answer_path}  ({len(out)} chars)")

        head = out[:80]
        if not out:
            log("回答が空でした")
            return 4
        if any(m in head for m in BAD_HEAD_MARKERS):
            log(f"回答が定型文・拒否・古いバブルの可能性: head={head!r}")
            return 4
        log("=== 正常終了 ===")
        return 0

    except Exception as e:
        import traceback
        log("例外: " + repr(e))
        log(traceback.format_exc())
        return 1
    finally:
        try:
            if ctx:
                ctx.close()
        except Exception:
            pass
        try:
            pw.stop()
        except Exception:
            pass


def _dump_conversation(page) -> None:
    try:
        us = page.query_selector_all(".from-user-container")
        bs = page.query_selector_all(".to-user-container")
        parts = [f"# NotebookLM conversation dump  {datetime.datetime.now():%Y-%m-%d %H:%M:%S}",
                 f"# user bubbles={len(us)}  answer bubbles={len(bs)}", ""]
        for i, u in enumerate(us):
            parts.append(f"===== USER[{i}] =====\n{u.inner_text().strip()[:600]}\n")
        for i, b in enumerate(bs):
            parts.append(f"===== ANS[{i}] =====\n{b.inner_text().strip()}\n")
        CONV_DUMP_PATH.write_text("\n".join(parts), encoding="utf-8")
        log(f"会話ダンプを保存: {CONV_DUMP_PATH}")
    except Exception as e:
        log(f"会話ダンプ失敗: {e}")


if __name__ == "__main__":
    sys.exit(main())
