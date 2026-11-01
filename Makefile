.PHONY: check package build clean

check:
	python3 scripts/package.py --check

package: check
	python3 scripts/package.py

build: package

clean:
	rm -rf dist
