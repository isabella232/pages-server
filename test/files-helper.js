'use strict';

var fs = require('fs');
var path = require('path');
var temp = require('temp');
var scriptName = require('../package.json').name;

module.exports = FilesHelper;

function FilesHelper() {
}

FilesHelper.prototype.init = function() {
  var helper = this;

  this.dirs = [];
  this.files = [];

  return new Promise(function(resolve, reject) {
    temp.mkdir(scriptName + '-test-files-', function(err, tempDir) {
      if (err) {
        return reject(err);
      }
      helper.tempDir = tempDir;
      resolve();
    });
  });
};

FilesHelper.prototype.afterEach = function() {
  var helper = this;

  return removeItems(this.tempDir, this.files, 'unlink')
    .then(function() {
      return removeItems(helper.tempDir, helper.dirs.reverse(), 'rmdir');
    });
};

FilesHelper.prototype.after = function() {
  return removeItems(this.tempDir, [''], 'rmdir');
};

FilesHelper.prototype.createDir = function(dirName) {
  var helper = this;

  return new Promise(function(resolve, reject) {
    fs.mkdir(path.join(helper.tempDir, dirName), '0700', function(err) {
      if (err) {
        return reject(err);
      }
      helper.dirs.push(dirName);
      resolve();
    });
  });
};

function removeItems(parentDir, items, operation) {
  var remover;

  remover = function(result, item) {
    return result.then(function() {
      return removeItem(parentDir, item, operation);
    });
  };
  return items.reduce(remover, Promise.resolve());
}

function removeItem(parentDir, name, operation) {
  var itemPath = path.join(parentDir, name);

  return new Promise(function(resolve, reject) {
    fs.exists(itemPath, function(exists) {
      if (!exists) {
        return resolve();
      }
      fs[operation](itemPath, function(err) {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  });
}
