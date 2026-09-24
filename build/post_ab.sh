#!/bin/sh
# usage: build/post_ab.sh <html> <views> [extra shot args]
H=$1; V=$2; shift 2
node tools/shot.mjs --html $H --views $V --outdir shots/post "$@" 2>&1 | grep -v "^REPORT_JSON" | tail -6
node tools/shot.mjs --html $H --views $V --outdir shots/post --prefix nopost_ --eval "COZY.post.setEnabled(false)" "$@" 2>&1 | grep -v "^REPORT_JSON" | tail -3
