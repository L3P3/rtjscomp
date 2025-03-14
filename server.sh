#!/bin/bash

while true
do
	if command -v bun >/dev/null 2>&1; then
		echo "runtime: bun"
		bun run rtjscomp.js
	else
		if command -v node >/dev/null 2>&1; then
			echo "runtime: node"
			node rtjscomp.js
		else
			echo "Error: Neither bun nor node is installed"
			exit 1
		fi
	fi

	if [ $? -eq 0 ]; then
		exit 0
	fi

	echo "failed, re-run..."
	sleep 1
done
