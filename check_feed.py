#!/usr/bin/env python3
"""Check whether a site already publishes its own RSS/Atom feed before writing
a scraper config for it — always check this first, most blogs/CMSs (WordPress,
Ghost, Substack, Medium, etc.) already have one and scraping would be wasted
effort.

Usage:
    python check_feed.py https://example.com/blog
"""
from __future__ import annotations

import sys

import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (compatible; PersonalSiteRSSBot/1.0)"
COMMON_PATHS = ["/feed", "/feed/", "/rss", "/rss.xml", "/atom.xml", "/index.xml"]


def find_declared_feeds(url: str) -> list[tuple[str, str]]:
    resp = requests.get(url, headers={"User-Agent": UA}, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    found = []
    for link in soup.find_all("link", rel=lambda v: v and "alternate" in v):
        t = link.get("type", "")
        if "rss" in t or "atom" in t:
            href = link.get("href")
            if href:
                found.append((t, href))
    return found


def probe_common_paths(base_url: str) -> list[str]:
    from urllib.parse import urljoin

    hits = []
    for path in COMMON_PATHS:
        candidate = urljoin(base_url, path)
        try:
            resp = requests.get(candidate, headers={"User-Agent": UA}, timeout=10)
            ctype = resp.headers.get("content-type", "")
            if resp.status_code == 200 and ("xml" in ctype or "rss" in ctype or resp.text.lstrip().startswith("<?xml")):
                hits.append(candidate)
        except requests.RequestException:
            pass
    return hits


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    target = sys.argv[1]
    declared = find_declared_feeds(target)
    if declared:
        print(f"{target} declares (a) feed(s):")
        for t, href in declared:
            print(f"  {t}: {href}")
        sys.exit(0)

    print(f"No <link rel=alternate> feed declared on {target}. Probing common feed paths...")
    hits = probe_common_paths(target)
    if hits:
        print("Found a feed at a common path:")
        for h in hits:
            print(f"  {h}")
    else:
        print("No feed found. You'll need a scraper config (see sites/anthropic-news.yaml for an example, and README.md).")
