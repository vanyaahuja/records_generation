PYTHON ?= backend/.venv/bin/python
.PHONY: gen up up-offline test eval e2e e2e-offline stats
gen:
	$(PYTHON) tools/contracts.py
up:
	docker compose up --build -d
up-offline:
	docker compose up --no-build --pull never -d
test:
	$(PYTHON) -m pytest -q backend/tests
	$(PYTHON) tools/contracts.py --check
	cd frontend && npm run build
eval:
	$(PYTHON) eval/run.py --check
e2e:
	cd frontend && npm run test:e2e
e2e-offline:
	$(PYTHON) -m pytest -q backend/tests/test_offline.py
	$(PYTHON) tools/container_smoke.py
stats:
	$(PYTHON) eval/generate.py
