# Changelog

Alle Änderungen an der Zettelwirtschaft. Wird bei jedem Release automatisch aus den Commit-Nachrichten erzeugt.

# [1.5.0](https://github.com/makampf/zettelwirtschaft/compare/v1.4.2...v1.5.0) (2026-10-01)


### Features

* import documents from Paperless-ngx via webhook ([abae17a](https://github.com/makampf/zettelwirtschaft/commit/abae17a05f923bbe408fd74a236a45d45cc18e30))

## [1.4.2](https://github.com/makampf/zettelwirtschaft/compare/v1.4.1...v1.4.2) (2026-09-30)


### Bug Fixes

* match statement lines to open invoices first and by nearby date ([484ddfb](https://github.com/makampf/zettelwirtschaft/commit/484ddfb3c0456d1fef779f9a6ab1ed1fac4742a5))

## [1.4.1](https://github.com/makampf/zettelwirtschaft/compare/v1.4.0...v1.4.1) (2026-09-30)


### Bug Fixes

* keep earlier results when a submission is settled in several statements ([8ef8d49](https://github.com/makampf/zettelwirtschaft/commit/8ef8d494eae9724c08454287458a5e3f13462f87))

# [1.4.0](https://github.com/makampf/zettelwirtschaft/compare/v1.3.1...v1.4.0) (2026-09-30)


### Features

* warn about duplicates and unsaved changes ([65f937a](https://github.com/makampf/zettelwirtschaft/commit/65f937a7f47bb43529c3b50ed9b7308b4648bd4c))

## [1.3.1](https://github.com/makampf/zettelwirtschaft/compare/v1.3.0...v1.3.1) (2026-09-30)


### Bug Fixes

* read the total and skip service periods in Beihilfe notices ([fb38dfc](https://github.com/makampf/zettelwirtschaft/commit/fb38dfc43f9222c9d0597e1a87f3e55ad537d923))

# [1.3.0](https://github.com/makampf/zettelwirtschaft/compare/v1.2.0...v1.3.0) (2026-09-30)


### Features

* read benefit statements, bulk edit invoices and release held-back invoices ([138b460](https://github.com/makampf/zettelwirtschaft/commit/138b46094b1fc4146c5ff532484c439bc6866008))

# [1.2.0](https://github.com/makampf/zettelwirtschaft/compare/v1.1.1...v1.2.0) (2026-09-29)


### Features

* treat private health and care insurance as one contract by default ([706d12b](https://github.com/makampf/zettelwirtschaft/commit/706d12b2666dc03656881f55f2d94fe119fc27ff))

## [1.1.1](https://github.com/makampf/zettelwirtschaft/compare/v1.1.0...v1.1.1) (2026-09-29)


### Bug Fixes

* offer to reset browser data when stored data cannot be loaded ([69ab50c](https://github.com/makampf/zettelwirtschaft/commit/69ab50c9123ea35b5b6e0f5f8555c12f86ceea53))

# [1.1.0](https://github.com/makampf/zettelwirtschaft/compare/v1.0.1...v1.1.0) (2026-09-29)


### Bug Fixes

* read scanned PDFs in browsers without Map.getOrInsertComputed ([0702eae](https://github.com/makampf/zettelwirtschaft/commit/0702eae132acc4302fea92469cba56c2130558e8))


### Features

* recognize billing offices and take over the treating doctor ([5ef8fd8](https://github.com/makampf/zettelwirtschaft/commit/5ef8fd80213b31e8d4babc663ca8177d7d66968c))

## [1.0.1](https://github.com/makampf/zettelwirtschaft/compare/v1.0.0...v1.0.1) (2026-09-29)


### Bug Fixes

* use English file names and the Zettelwirtschaft name throughout ([3c8c691](https://github.com/makampf/zettelwirtschaft/commit/3c8c69163fb491b1c51bef26b9b08d930bbeb021))

# 1.0.0 (2026-09-29)


### Bug Fixes

* improve receipt recognition ([7ad0558](https://github.com/makampf/zettelwirtschaft/commit/7ad05589bb15b75de5d10dcfbdf6a255190ca25b))


### Features

* add invoice manager for Beihilfe, private health and care insurance ([4c17648](https://github.com/makampf/zettelwirtschaft/commit/4c176485f457b5d578f48c8fd57ebc3852f68c77))
* add self-hosted server with Postgres storage ([e8e81cb](https://github.com/makampf/zettelwirtschaft/commit/e8e81cbee25485747dbe82483c9cad49f326c35b))
* allow premium refunds with unknown amount ([a5fc2e1](https://github.com/makampf/zettelwirtschaft/commit/a5fc2e1494fa34cf468bbb6557ad0035b4062e8b))
* prefill invoices from receipts read on the device ([bab33b0](https://github.com/makampf/zettelwirtschaft/commit/bab33b0fd1eb37ee4d036851db333747a3b17ce2))
* shared deductible for health and care, tariffs and jointly insured persons ([ddbc9ae](https://github.com/makampf/zettelwirtschaft/commit/ddbc9aefae8906e98d028b78cd1ee994e014c2ae))
* show version, author and license links in the footer ([f53b383](https://github.com/makampf/zettelwirtschaft/commit/f53b383cce8e4456960ceb2cefc8112b67d3b3e7))
* suggest known providers and detect invoice numbers reliably ([5a61a7e](https://github.com/makampf/zettelwirtschaft/commit/5a61a7e739bdde05b60dee13d8bb149e8978fa6a))
* support deductibles, preventive care and premium refunds ([8338d11](https://github.com/makampf/zettelwirtschaft/commit/8338d114b5fb6de3c06e6f22173990a16afe4283))
