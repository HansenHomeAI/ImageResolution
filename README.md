# ImageResolution

A Playwright-based automation script for processing images through Google Gemini and Nano Banana using a pro account.

## Overview

This project automates the process of:
- Logging into Google Gemini account
- Processing multiple photos through Google Gemini
- Processing photos through Nano Banana
- Downloading the processed images

## Setup

- Install dependencies: `npm install`
- First run will open a browser window for manual login

## Usage

- Run with defaults:
  - `npm start`
- Run a small test batch of 5 images:
  - `npm start -- --limit 5`
- Custom input/output:
  - `npm start -- --input ~/Downloads/frames_DJI_0924_0926_3s/all --output ./output/upscaled_images/`

## Notes

- Persistent browser data lives in `browser-data/`.
- Output, logs, and state live in `output/upscaled_images/`.
