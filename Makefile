PYTHON ?= python3.12
VENV := .venv
VENV_STAMP := $(VENV)/.installed
FRONTEND_STAMP := addon/frontend/node_modules/.installed

.PHONY: harness test smoke soak lint clean

$(VENV_STAMP): addon/requirements-dev.txt addon/requirements.txt
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/python -m pip install -r addon/requirements-dev.txt
	touch $(VENV_STAMP)

$(FRONTEND_STAMP): addon/frontend/package.json addon/frontend/package-lock.json
	npm --prefix addon/frontend ci
	touch $(FRONTEND_STAMP)

harness: $(VENV_STAMP) $(FRONTEND_STAMP)
	npm --prefix addon/frontend run build
	npm --prefix addon/frontend run build:simulator
	PYTHONPATH=addon/src $(VENV)/bin/python dev/harness.py

test: $(VENV_STAMP)
	$(VENV)/bin/python -m pytest -m "not soak"

smoke: $(VENV_STAMP)
	docker build --build-arg BUILD_VERSION=smoke --build-arg BUILD_ARCH=amd64 --tag heat-steward-smoke:local addon
	PYTHONPATH=addon/src $(VENV)/bin/python scripts/smoke_test.py --image heat-steward-smoke:local

soak: $(VENV_STAMP)
	$(VENV)/bin/python -m pytest -m soak

lint: $(VENV_STAMP)
	$(VENV)/bin/python -m ruff check .
	$(VENV)/bin/python -m ruff format --check .

clean:
	rm -rf addon/frontend/dist
	rm -rf addon/frontend/simulator-dist
