/*
 * Copyright 2018 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const compareImages = require('resemblejs/compareImages');

/**
 * Computes the difference between two screenshot images and generates an image that highlights the pixels that changed.
 */
class ImageDiffer {
  constructor({imageCache}) {
    /**
     * @type {!ImageCache}
     * @private
     */
    this.imageCache_ = imageCache;
  }

  /**
   * @param {!SnapshotSuiteJson} actualSuite
   * @param {!SnapshotSuiteJson} expectedSuite
   * @return {!Promise<!Array<!ImageDiffJson>>}
   */
  async compareAllPages({
    actualSuite,
    expectedSuite,
  }) {
    /** @type {!Array<!Promise<!Array<!ImageDiffJson>>>} */
    const pagePromises = [];

    for (const [htmlFilePath, actualPage] of Object.entries(actualSuite)) {
      // HTML file is not present in `golden.json` on `master`
      const expectedPage = expectedSuite[htmlFilePath];
      if (!expectedPage) {
        continue;
      }

      pagePromises.push(
        this.compareOnePage_({
          htmlFilePath,
          goldenPageUrl: expectedPage.publicUrl,
          snapshotPageUrl: actualPage.publicUrl,
          actualPage,
          expectedPage,
        })
      );
    }

    // Flatten the array of arrays
    const diffResults = [].concat(...(await Promise.all(pagePromises)));

    // Filter out images with no diffs
    return diffResults.filter((diffResult) => Boolean(diffResult.diffImageBuffer));
  }

  /**
   * @param {string} htmlFilePath
   * @param {string} goldenPageUrl
   * @param {string} snapshotPageUrl
   * @param {!SnapshotPageJson} actualPage
   * @param {!SnapshotPageJson} expectedPage
   * @return {!Promise<!Array<!ImageDiffJson>>}
   * @private
   */
  async compareOnePage_({
    htmlFilePath,
    goldenPageUrl,
    snapshotPageUrl,
    actualPage,
    expectedPage,
  }) {
    /** @type {!Array<!Promise<!ImageDiffJson>>} */
    const imagePromises = [];

    const actualScreenshots = actualPage.screenshots;
    const expectedScreenshots = expectedPage.screenshots;

    for (const [userAgentAlias, actualImageUrl] of Object.entries(actualScreenshots)) {
      // Screenshot image for this browser is not present in `golden.json` on `master`
      const expectedImageUrl = expectedScreenshots[userAgentAlias];
      if (!expectedImageUrl) {
        continue;
      }

      imagePromises.push(
        this.compareOneImage_({actualImageUrl, expectedImageUrl})
          .then(
            (diffImageBuffer) => ({
              htmlFilePath,
              goldenPageUrl,
              snapshotPageUrl,
              userAgentAlias,
              expectedImageUrl,
              actualImageUrl,
              diffImageUrl: null, // populated by `Controller`
              diffImageBuffer,
            }),
            (err) => Promise.reject(err)
          )
      );
    }

    return Promise.all(imagePromises);
  }

  /**
   * @param {string} actualImageUrl
   * @param {string} expectedImageUrl
   * @return {!Promise<?Buffer>}
   * @private
   */
  async compareOneImage_({
    actualImageUrl,
    expectedImageUrl,
  }) {
    console.log(`➡ Comparing snapshot to golden: "${actualImageUrl}" vs. "${expectedImageUrl}"...`);

    const [actualImageBuffer, expectedImageBuffer] = await Promise.all([
      this.imageCache_.getImageBuffer(actualImageUrl),
      this.imageCache_.getImageBuffer(expectedImageUrl),
    ]);

    const diffResult = await this.computeDiff_({
      actualImageBuffer,
      expectedImageBuffer,
    });

    if (diffResult.rawMisMatchPercentage < 0.01) {
      console.log(`✔ No diffs found for "${actualImageUrl}"!`);
      return null;
    }

    console.log(`✗︎ Image "${actualImageUrl}" has changed!`);
    return diffResult.getBuffer();
  }

  /**
   * @param {!Buffer} actualImageBuffer
   * @param {!Buffer} expectedImageBuffer
   * @return {!Promise<!ResembleApiComparisonResult>}
   * @private
   */
  async computeDiff_({
    actualImageBuffer,
    expectedImageBuffer,
  }) {
    const options = require('../resemble.json');
    return await compareImages(
      actualImageBuffer,
      expectedImageBuffer,
      options
    );
  }
}

module.exports = ImageDiffer;
