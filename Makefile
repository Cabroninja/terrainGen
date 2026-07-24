.PHONY: run test docker
run:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

test:
	pytest -q

docker:
	docker compose up -d --build
