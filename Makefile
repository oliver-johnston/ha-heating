PYTHON ?= python3.12
VENV := .venv
FRONTEND_STAMP := addon/frontend/node_modules/.installed

.PHONY: harness test lint clean

$(VENV)/bin/python: addon/requirements-dev.txt addon/requirements.txt
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/pip install -r addon/requirements-dev.txt

$(FRONTEND_STAMP): addon/frontend/package.json addon/frontend/package-lock.json
	npm --prefix addon/frontend ci
	touch $(FRONTEND_STAMP)

harness: $(VENV)/bin/python $(FRONTEND_STAMP)
	npm --prefix addon/frontend run build
	npm --prefix addon/frontend run build:simulator
	PYTHONPATH=addon/src $(VENV)/bin/python dev/harness.py

test: $(VENV)/bin/python
	$(VENV)/bin/pytest

lint: $(VENV)/bin/python
	$(VENV)/bin/ruff check .
	$(VENV)/bin/ruff format --check .

clean:
	rm -rf addon/frontend/dist
	rm -rf addon/frontend/simulator-dist
