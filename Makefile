.PHONY: test ci demo demo:omega demo:cellular attacks posture cover quick dashboard help setup

help:
	@echo "NEXA targets:"
	@echo "  test        npm test (314 tests)"
	@echo "  quick       tests + posture (dev loop)"
	@echo "  ci          full CI suite"
	@echo "  posture     security posture check"
	@echo "  attacks     31/31 Ω attacks + 8/8 Google"
	@echo "  cover       coverage report to .coverage/"
	@echo "  demo        all demos"
	@echo "  dashboard   start dashboard dev server"
	@echo "  setup       install dashboard deps"

test:
	node --test

quick:
	npm run verify:quick

ci:
	npm run verify:ci

posture:
	node tools/check-posture.mjs

attacks:
	node tools/omega-attacks.mjs
	node tools/google-attacks.mjs

cover:
	npm run cover

demo:
	node tools/demo.mjs
	node tools/omega-demo.mjs
	node tools/cellular-demo.mjs

dashboard:
	cd dashboard && npm install && npm run dev

setup:
	cd dashboard && npm install
