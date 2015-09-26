/* jshint node: true */
/* jshint expr: true */
/* jshint mocha: true */
'use strict';

var fs = require('fs');
var path = require('path');
var chai = require('chai');
var chaiAsPromised = require('chai-as-promised');
var sinon = require('sinon');
var childProcess = require('child_process');
var mockSpawn = require('mock-spawn');
var siteBuilder = require('../lib/site-builder');
var buildLogger = require('../lib/build-logger');
var fileLockedOperation = require('file-locked-operation');

var config = require('../pages-config.json');
config.home = '';
config.git = 'git';
config.bundler = 'bundle';
config.jekyll = 'jekyll';
config.rsync = 'rsync';

var expect = chai.expect;
chai.should();
chai.use(chaiAsPromised);

describe('SiteBuilder', function() {
  var builder, origSpawn, mySpawn, logger, logMock;
  var lockDir, lockfilePath, updateLock;
  var testRepoDir, fileToDelete, gemfile, pagesConfig, configYml;

  before(function(done) {
    siteBuilder.setConfiguration(config);
    testRepoDir = path.resolve(__dirname, 'site_builder_test');
    gemfile = path.resolve(testRepoDir, 'Gemfile');
    pagesConfig = path.resolve(testRepoDir, config.pagesConfig);
    configYml = path.resolve(testRepoDir, '_config.yml');
    lockDir = path.resolve(__dirname, 'site_builder_test_lock_dir');
    lockfilePath = path.resolve(lockDir, '.update-lock-repo_name');
    fs.mkdir(lockDir, '0700', done);
  });

  after(function(done) { fs.rmdir(lockDir, done); });

  beforeEach(function() {
    origSpawn = childProcess.spawn;
    mySpawn = mockSpawn();
    childProcess.spawn = mySpawn;
    logger = new buildLogger.BuildLogger('/dev/null');
    logMock = sinon.mock(logger);
    updateLock = new fileLockedOperation.FileLockedOperation(lockfilePath);
  });

  var removeFile = function(filename) {
    if (!filename) { return Promise.resolve(); }
    return new Promise(function(resolve, reject) {
      fs.exists(filename, function(exists) {
        if (exists) {
          fs.unlink(filename, function(err) {
            if (err) { reject(err); } else { resolve(); }
          });
        }
        resolve();
      });
    });
  };

  afterEach(function(done) {
    childProcess.spawn = origSpawn;

    var removeRepoDir = function() {
      return new Promise(function(resolve, reject) {
        fs.exists(testRepoDir, function(exists) {
          if (!exists) { return resolve(); }
          fs.rmdir(testRepoDir, function(err) {
            if (err) { reject(err); } else { resolve(); }
          });
        });
      });
    };
    removeFile(configYml)
      .then(function() { return removeFile(fileToDelete); })
      .then(removeRepoDir)
      .then(done, done);
  });

  var spawnCalls = function() {
    return mySpawn.calls.map(function(value) {
      return value.command + ' ' + value.args.join(' ');
    });
  };

  var check = function(done, cb) {
    return function(err) { try { cb(err); done(); } catch (e) { done(e); } };
  };

  var createRepoDir = function(done) {
    fs.mkdir(testRepoDir, '0700', function() {
      fs.writeFile(configYml, '', done);
    });
  };

  var createRepoWithFile = function(filename, contents, done) {
    fileToDelete = filename;
    createRepoDir(function() { fs.writeFile(filename, contents, done); });
  };

  var makeBuilder = function() {
    var info = {
      repository: {
        name: 'repo_name'
      },
      ref: 'refs/heads/18f-pages'
    };

    var builderConfig = {
        'branch': '18f-pages',
        'repositoryDir': 'repo_dir',
        'generatedSiteDir': 'dest_dir'
    };

    var opts = new siteBuilder.Options(info, builderConfig);
    opts.sitePath = testRepoDir;
    return new siteBuilder.SiteBuilder(opts, logger, updateLock);
  };

  it('should write the expected configuration', function(done) {
    builder = makeBuilder();
    logMock.expects('log').withExactArgs(
      'generating', config.pagesConfig);
    logMock.expects('log').withExactArgs(
      'removing generated', config.pagesConfig);

    var inRepoDir = new Promise(function(resolve, reject) {
      createRepoDir(function(err) {
        if (err) { reject(err); } else { resolve(); }
      });
    });

    var writeConfig = function() {
      var configExists;
      return builder.readOrWriteConfig(configExists = false);
    };

    var readConfig = function() {
      expect(builder.generatedConfig).to.be.true;
      return new Promise(function(resolve, reject) {
        fs.readFile(pagesConfig, function(err, data) {
          if (err) { reject(err); } else { resolve(data.toString()); }
        });
      });
    };

    var checkResults = function(content) {
      expect(content).to.equal('baseurl: /repo_name\n' +
        'asset_root: ' + config.assetRoot + '\n');
      return new Promise(function(resolve, reject) {
        // Note the done callback wrapper will remove the generated config.
        var buildDone = builder.generateBuildDone(function(err) {
          if (err) { reject(err); } else { resolve(); }
        });
        buildDone();
      });
    };

    inRepoDir.then(writeConfig).then(readConfig).then(checkResults)
        .then(function() { logMock.verify(); }).should.notify(done);
  });

  // Note that this internal function will only get called when a
  // _config_18f_pages.yml file is present, not generated. Otherwise the
  // server will generate this file, and the baseurl will match the output
  // directory already.
  describe('_parseDestinationFromConfigData', function() {
    beforeEach(function() {
      builder = makeBuilder();
    });

    it('should keep the default destination if undefined', function() {
      builder._parseDestinationFromConfigData('');
      expect(builder.buildDestination).to.equal('dest_dir/repo_name');
    });

    it('should keep the default destination if empty', function() {
      builder._parseDestinationFromConfigData('baseurl:\n');
      expect(builder.buildDestination).to.equal('dest_dir/repo_name');
    });

    it('should keep the default destination if empty with spaces', function() {
      builder._parseDestinationFromConfigData('baseurl:   \n');
      expect(builder.buildDestination).to.equal('dest_dir/repo_name');
    });

    it('should keep the default destination if set to root path', function() {
      builder._parseDestinationFromConfigData('baseurl: /\n');
      expect(builder.buildDestination).to.equal('dest_dir/repo_name');
    });

    it('should set the destination from config data baseurl', function() {
      builder._parseDestinationFromConfigData('baseurl: /new-destination\n');
      expect(builder.buildDestination).to.equal('dest_dir/new-destination');
    });

    it('should parse baseurl if no leading space', function() {
      builder._parseDestinationFromConfigData('baseurl:/new-destination\n');
      expect(builder.buildDestination).to.equal('dest_dir/new-destination');
    });

    it('should trim all spaces around baseurl', function() {
      builder._parseDestinationFromConfigData(
        'baseurl:   /new-destination   \n');
      expect(builder.buildDestination).to.equal('dest_dir/new-destination');
    });
  });

  it('should clone the repo if the directory does not exist', function(done) {
    mySpawn.setDefault(mySpawn.simple(0));
    mySpawn.sequence.add(function(done) {
      createRepoDir(function() { done(0); });
    });

    logMock.expects('log').withExactArgs(
      'cloning', 'repo_name', 'into', testRepoDir);
    logMock.expects('log').withExactArgs(
      'generating', config.pagesConfig);
    logMock.expects('log').withExactArgs(
      'removing generated', config.pagesConfig);
    makeBuilder().build(check(done, function(err) {
      expect(err).to.be.undefined;
      expect(spawnCalls()).to.eql([
        'git clone git@github.com:18F/repo_name.git --branch 18f-pages',
        'jekyll build --trace --destination dest_dir/repo_name ' +
          '--config _config.yml,_config_18f_pages.yml',
      ]);
      logMock.verify();
    }));
  });

  it('should report an error if the clone fails', function(done) {
    mySpawn.sequence.add(mySpawn.simple(1));
    logMock.expects('log').withExactArgs(
      'cloning', 'repo_name', 'into', testRepoDir);
    makeBuilder().build(check(done, function(err) {
      var cloneCommand = 
        'git clone git@github.com:18F/repo_name.git --branch 18f-pages';
      expect(err).to.equal('Error: failed to clone repo_name with ' +
        'exit code 1 from command: ' + cloneCommand);
      expect(spawnCalls()).to.eql([cloneCommand]);
      logMock.verify();
    }));
  });

  it('should sync the repo if the directory already exists', function(done) {
    mySpawn.setDefault(mySpawn.simple(0));
    logMock.expects('log').withExactArgs('syncing repo:', 'repo_name');
    logMock.expects('log').withExactArgs(
      'generating', config.pagesConfig);
    logMock.expects('log').withExactArgs(
      'removing generated', config.pagesConfig);
    createRepoDir(function() {
      makeBuilder().build(check(done, function(err) {
        expect(err).to.be.undefined;
        expect(spawnCalls()).to.eql([
          'git stash',
          'git pull',
          'jekyll build --trace --destination dest_dir/repo_name ' +
            '--config _config.yml,_config_18f_pages.yml',
        ]);
        logMock.verify();
      }));
    });
  });

  it ('should use bundler if a Gemfile is present', function(done) {
    mySpawn.setDefault(mySpawn.simple(0));
    logMock.expects('log').withExactArgs('syncing repo:', 'repo_name');
    logMock.expects('log').withExactArgs(
      'generating', config.pagesConfig);
    logMock.expects('log').withExactArgs(
      'removing generated', config.pagesConfig);
    createRepoWithFile(gemfile, '', function() {
      makeBuilder().build(check(done, function(err) {
        expect(err).to.be.undefined;
        expect(spawnCalls()).to.eql([
          'git stash',
          'git pull',
          'bundle install',
          'bundle exec jekyll build --trace --destination dest_dir/repo_name ' +
            '--config _config.yml,_config_18f_pages.yml',
        ]);
        logMock.verify();
      }));
    });
  });

  it ('should fail if bundle install fails', function(done) {
    mySpawn.sequence.add(mySpawn.simple(0));
    mySpawn.sequence.add(mySpawn.simple(0));
    mySpawn.sequence.add(mySpawn.simple(1));
    logMock.expects('log').withExactArgs('syncing repo:', 'repo_name');
    createRepoWithFile(gemfile, '', function() {
      makeBuilder().build(check(done, function(err) {
        var bundleInstallCommand = 'bundle install';
        expect(err).to.equal('Error: rebuild failed for repo_name with ' +
          'exit code 1 from command: ' + bundleInstallCommand);
        expect(spawnCalls()).to.eql([
          'git stash', 'git pull', bundleInstallCommand]);
        logMock.verify();
      }));
    });
  });

  it ('should fail if jekyll build fails', function(done) {
    mySpawn.sequence.add(mySpawn.simple(0));
    mySpawn.sequence.add(mySpawn.simple(0));
    mySpawn.sequence.add(mySpawn.simple(0));
    mySpawn.sequence.add(mySpawn.simple(1));
    logMock.expects('log').withExactArgs('syncing repo:', 'repo_name');
    logMock.expects('log').withExactArgs(
      'generating', config.pagesConfig);
    logMock.expects('log').withExactArgs(
      'removing generated', config.pagesConfig);
    createRepoWithFile(gemfile, '', function() {
      makeBuilder().build(check(done, function(err) {
        var jekyllBuildCommand =
          'bundle exec jekyll build --trace --destination dest_dir/repo_name ' +
            '--config _config.yml,_config_18f_pages.yml';
        expect(err).to.equal('Error: rebuild failed for repo_name with ' +
          'exit code 1 from command: ' + jekyllBuildCommand);
        expect(spawnCalls()).to.eql([
          'git stash', 'git pull', 'bundle install', jekyllBuildCommand]);
        logMock.verify();
      }));
    });
  });

  it('should use existing _config_18f_pages.yml if present', function(done) {
    mySpawn.setDefault(mySpawn.simple(0));
    logMock.expects('log').withExactArgs('syncing repo:', 'repo_name');
    logMock.expects('log').withExactArgs(
      'using existing', config.pagesConfig);
    createRepoWithFile(pagesConfig, '', function() {
      makeBuilder().build(check(done, function(err) {
        expect(err).to.be.undefined;
        expect(spawnCalls()).to.eql([
          'git stash',
          'git pull',
          'jekyll build --trace --destination dest_dir/repo_name ' +
            '--config _config.yml,_config_18f_pages.yml',
        ]);
        logMock.verify();
      }));
    });
  });

  it('should use baseurl from _config_18f_pages.yml as dest', function(done) {
    mySpawn.setDefault(mySpawn.simple(0));
    logMock.expects('log').withExactArgs('syncing repo:', 'repo_name');
    logMock.expects('log').withExactArgs(
      'using existing', config.pagesConfig);
    createRepoWithFile(pagesConfig, 'baseurl:  /new-destination  ', function() {
      makeBuilder().build(check(done, function(err) {
        expect(err).to.be.undefined;
        expect(spawnCalls()).to.eql([
          'git stash',
          'git pull',
          'jekyll build --trace --destination dest_dir/new-destination ' +
            '--config _config.yml,_config_18f_pages.yml',
        ]);
        logMock.verify();
      }));
    });
  });

  it('should use rsync if _config.yml is not present', function(done) {
    mySpawn.setDefault(mySpawn.simple(0));
    logMock.expects('log').withExactArgs('syncing repo:', 'repo_name');
    createRepoWithFile(pagesConfig, '', function() {
      removeFile(configYml)
        .then(function() {
          makeBuilder().build(check(done, function(err) {
            expect(err).to.be.undefined;
            expect(spawnCalls()).to.eql([
              'git stash',
              'git pull',
              'rsync -vaxp --delete --ignore-errors --exclude=.[A-Za-z0-9]* ' +
                './ dest_dir/repo_name',
            ]);
            logMock.verify();
          }));
        });
    });
  });

  describe('makeBuilderListener and launchBuilder', function() {
    var webhook, incomingPayload, builderConfig, cloneDir, outputDir, buildLog;

    before(function() {
      incomingPayload = {
        'ref': 'refs/heads/18f-pages',
        'repository': { 'name': 'foo', 'full_name': '18F/foo' },
        'head_commit': {
          'id': 'deadbeef',
          'message': 'Build me',
          'timestamp': '2015-09-25',
          'committer': { 'email': 'michael.bland@gsa.gov' }
        },
        'pusher': { 'name': 'Mike Bland', 'email': 'michael.bland@gsa.gov' },
        'sender': { 'login': 'mbland' }
      };

      builderConfig = {
        'branch': '18f-pages',
        'repositoryDir': path.join(testRepoDir, 'repo_dir'),
        'generatedSiteDir': path.join(testRepoDir, 'dest_dir')
      };

      cloneDir = path.join(testRepoDir, 'repo_dir', 'foo');
      outputDir = path.join(testRepoDir, 'dest_dir', 'foo');
      buildLog = path.join(outputDir, 'build.log');
    });

    beforeEach(function(done) {
      webhook = { on: sinon.spy() };
      fs.mkdir(testRepoDir, function(err) {
        if (err) { return done(err); }
        fs.mkdir(builderConfig.repositoryDir, function(err) {
          if (err) { return done(err); }
          fs.mkdir(builderConfig.generatedSiteDir, function(err) {
            if (err) { return done(err); }
            fs.mkdir(outputDir, done);
          });
        });
      });
    });

    // The outer afterEach() will remove the testRepoDir.
    afterEach(function(done) {
      fs.unlink(buildLog, function() {
        fs.rmdir(outputDir, function(err) {
          if (err) { return done(err); }
          fs.rmdir(builderConfig.generatedSiteDir, function(err) {
            if (err) { return done(err); }
            fs.rmdir(builderConfig.repositoryDir, done);
          });
        });
      });
    });

    var captureLogs = function() {
      sinon.stub(console, 'log').returns(null);
      sinon.stub(console, 'error').returns(null);
    };

    var restoreLogs = function() {
      console.error.restore();
      console.log.restore();
    };

    it('should create a function to launch a builder', function() {
      siteBuilder.makeBuilderListener(webhook, builderConfig);
      expect(webhook.on.calledOnce).to.be.true;
      var args = webhook.on.args[0];
      expect(args.length).to.equal(2);
      expect(args[0]).to.equal('refs/heads/18f-pages');
      var launchBuilder = args[1];
      expect(launchBuilder).to.be.a.Function;
    });

    it('should create a builder that builds the site', function(done) {
      var checkResult = check(done, function(err) {
        var logMsgs = console.log.args;
        var errorMsgs = console.error.args;
        restoreLogs();
        expect(err).to.be.null;
        expect(logMsgs).to.eql([
          ['18F/foo: starting build at commit deadbeef'],
          ['description: Build me'],
          ['timestamp: 2015-09-25'],
          ['committer: michael.bland@gsa.gov'],
          ['pusher: Mike Bland michael.bland@gsa.gov'],
          ['sender: mbland'],
          ['cloning foo into ' + cloneDir],
          ['foo: build successful']
        ]);
        expect(errorMsgs).to.be.empty;
        var expectedLog = logMsgs.join('\n') + '\n';
        expect(fs.readFileSync(buildLog, 'utf8')).to.equal(expectedLog);
      });

      siteBuilder.makeBuilderListener(webhook, builderConfig, checkResult);
      var launchBuilder = webhook.on.args[0][1];
      mySpawn.setDefault(mySpawn.simple(0));
      captureLogs();
      launchBuilder(incomingPayload);
    });

    it('should create a builder that fails to build the site', function(done) {
      var checkResult = check(done, function(err) {
        var logMsgs = console.log.args;
        var errorMsgs = console.error.args;
        restoreLogs();
        expect(err).to.be.null;
        expect(logMsgs).to.eql([
          ['18F/foo: starting build at commit deadbeef'],
          ['description: Build me'],
          ['timestamp: 2015-09-25'],
          ['committer: michael.bland@gsa.gov'],
          ['pusher: Mike Bland michael.bland@gsa.gov'],
          ['sender: mbland'],
          ['cloning foo into ' + cloneDir],
        ]);
        expect(errorMsgs).to.eql([
          ['Error: failed to clone foo with exit code 1 from command: ' +
           'git clone git@github.com:18F/foo.git --branch 18f-pages'],
          ['foo: build failed']
        ]);
        var expectedLog = logMsgs.concat(errorMsgs).join('\n') + '\n';
        expect(fs.readFileSync(buildLog, 'utf8')).to.equal(expectedLog);
      });

      siteBuilder.makeBuilderListener(webhook, builderConfig, checkResult);
      var launchBuilder = webhook.on.args[0][1];
      mySpawn.setDefault(mySpawn.simple(1));
      captureLogs();
      launchBuilder(incomingPayload);
    });
  });
});
