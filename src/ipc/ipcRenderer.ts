/* eslint-disable @typescript-eslint/no-explicit-any */

import Electron from 'electron';
const { ipcRenderer } = Electron;
import _ from 'lodash';
import crypto from 'crypto';
import {
  DEBUG_IPC_CALLS,
  DEBUG_IPC_CALLS_GET_STATUS,
  IPC_CHANNEL_KEY,
  IPC_INIT_LOGS_RENDERER_SIDE,
  IPC_LOG_LINE
} from '../../sharedIpc';
import { store } from '../app/store';
import { appendToApplogs } from '../features/appLogsSlice';

const IPC_UPDATE_TIMEOUT = 5000; // 5 secs

const channelsToMake = {
  getSummaryStatus,
  addExit,
  deleteExit,
  setConfig,
  doStartLokinetProcess,
  doStopLokinetProcess,
  initLogsInRenderer
};
const channels = {} as any;
const _jobs = Object.create(null);

export const POLLING_STATUS_INTERVAL_MS = 500;

// shutting down clean handling
let _shuttingDown = false;
let _shutdownCallback: any = null;
let _shutdownPromise: any = null;

export async function getSummaryStatus(): Promise<string> {
  return channels.getSummaryStatus();
}
export async function addExit(
  exitAddress: string,
  exitToken?: string
): Promise<string> {
  console.info(
    `Triggering exit node set with node ${exitAddress}, authCode:${exitToken}`
  );
  return channels.addExit(exitAddress, exitToken);
}

export async function deleteExit(): Promise<string> {
  return channels.deleteExit();
}

export async function doStartLokinetProcess(): Promise<string | null> {
  return channels.doStartLokinetProcess();
}

export async function initLogsInRenderer(): Promise<Array<string> | null> {
  return channels.initLogsInRenderer();
}

export async function doStopLokinetProcess(): Promise<string | null> {
  return channels.doStopLokinetProcess();
}
export async function setConfig(
  section: string,
  key: string,
  value: string
): Promise<string> {
  return channels.setConfig(section, key, value);
}

export async function initializeIpcRendererSide(): Promise<void> {
  // We listen to a lot of events on ipcRenderer, often on the same channel. This prevents
  //   any warnings that might be sent to the console in that case.
  ipcRenderer.setMaxListeners(0);

  _.forEach(channelsToMake, (fn) => {
    if (_.isFunction(fn)) {
      makeChannel(fn.name);
    }
  });

  ipcRenderer.on(IPC_LOG_LINE, (_event, logLine: string) => {
    if (_.isString(logLine) && !_.isEmpty(logLine)) {
      store.dispatch(appendToApplogs(logLine));
    }
  });

  ipcRenderer.on(
    `${IPC_CHANNEL_KEY}-done`,
    (event, jobId, errorForDisplay, result: string | null) => {
      const job = _getJob(jobId);
      if (!job) {
        console.warn(
          `Received IPC channel reply to job ${jobId}, but did not have it in our registry!`
        );
        return;
      }

      const { resolve, reject, fnName } = job;

      if (errorForDisplay) {
        return reject(
          new Error(
            `Error received from IPC channel job ${jobId} (${fnName}): ${errorForDisplay}`
          )
        );
      }

      return resolve(result);
    }
  );
  ipcRenderer.once(
    IPC_INIT_LOGS_RENDERER_SIDE,
    (event, logLines: Array<string> | null) => {
      console.warn('after', logLines);

      if (logLines && logLines.length) {
        logLines.forEach((l) => store.dispatch(appendToApplogs(l)));
      }
    }
  );
  ipcRenderer.send(IPC_INIT_LOGS_RENDERER_SIDE);
}

async function _shutdown() {
  if (_shutdownPromise) {
    return _shutdownPromise;
  }

  _shuttingDown = true;

  const jobKeys = Object.keys(_jobs);
  console.log(
    `data.shutdown: starting process. ${jobKeys.length} jobs outstanding`
  );

  // No outstanding jobs, return immediately
  if (jobKeys.length === 0) {
    return null;
  }

  // Outstanding jobs; we need to wait until the last one is done
  _shutdownPromise = new Promise((resolve, reject) => {
    _shutdownCallback = (error: any) => {
      console.log('data.shutdown: process complete');
      if (error) {
        return reject(error);
      }

      return resolve(undefined);
    };
  });

  return _shutdownPromise;
}

function _makeJob(fnName: string) {
  if (_shuttingDown && fnName !== 'close') {
    throw new Error(
      `Rejecting IPC channel job (${fnName}); application is shutting down`
    );
  }

  const jobId = crypto.randomBytes(15).toString('hex');

  if (DEBUG_IPC_CALLS) {
    // console.log(`IPC channel job ${jobId} (${fnName}) started`);
  }
  _jobs[jobId] = {
    fnName
  };

  return jobId;
}

function _updateJob(id: string, data: any) {
  const { resolve, reject } = data;

  _jobs[id] = {
    ..._jobs[id],
    ...data,
    resolve: (value: any) => {
      _removeJob(id);
      return resolve(value);
    },
    reject: (error: any) => {
      _removeJob(id);
      return reject(error);
    }
  };
}

function _removeJob(id: string) {
  if (DEBUG_IPC_CALLS) {
    _jobs[id].complete = true;
    return;
  }

  if (_jobs[id].timer) {
    clearTimeout(_jobs[id].timer);
    _jobs[id].timer = null;
  }

  // tslint:disable-next-line: no-dynamic-delete
  delete _jobs[id];

  if (_shutdownCallback) {
    const keys = Object.keys(_jobs);
    if (keys.length === 0) {
      _shutdownCallback();
    }
  }
}

function _getJob(id: string) {
  return _jobs[id];
}

function makeChannel(fnName: string) {
  channels[fnName] = async (...args: any) => {
    const jobId = _makeJob(fnName);

    return new Promise((resolve, reject) => {
      ipcRenderer.send(IPC_CHANNEL_KEY, jobId, fnName, ...args);

      _updateJob(jobId, {
        resolve,
        reject,
        args: DEBUG_IPC_CALLS ? args : null
      });

      _jobs[jobId].timer = setTimeout(
        () =>
          reject(new Error(`IPC channel job ${jobId} (${fnName}) timed out`)),
        IPC_UPDATE_TIMEOUT
      );
    });
  };
}

export async function shutdown(): Promise<void> {
  // Stop accepting new SQL jobs, flush outstanding queue
  await _shutdown();
  await close();
}
// Note: will need to restart the app after calling this, to set up afresh
export async function close(): Promise<void> {
  await channels.close();
}

export interface DaemonSummaryStatus {
  isRunning: boolean;
  uptime?: number;
  version?: string;
  numPeersConnected: number;
  uploadUsage: number;
  downloadUsage: number;
  lokiAddress: string;
  numPathsBuilt: number;
  numRoutersKnown: number;
  ratio: string;
  exitNode?: string;
  exitAuthCode?: string;
}

export const defaultDaemonSummaryStatus: DaemonSummaryStatus = {
  isRunning: false,
  uptime: undefined,
  version: undefined,
  numPeersConnected: 0,
  uploadUsage: 0,
  downloadUsage: 0,
  lokiAddress: '',
  numPathsBuilt: 0,
  numRoutersKnown: 0,
  ratio: '',
  exitNode: undefined,
  exitAuthCode: undefined
};

export const parseSummaryStatus = (
  payload: string,
  error?: string
): DaemonSummaryStatus => {
  let stats = null;

  if (!payload || _.isEmpty(payload)) {
    console.warn('Empty payload fot for summary status');
    return defaultDaemonSummaryStatus;
  }

  // We can either have an error of communication, or an error on the returned JSON
  if (!error) {
    try {
      stats = JSON.parse(payload);
    } catch (e) {
      console.log("Couldn't parse 'summaryStatus' JSON-RPC payload", e);
    }
  }
  // if we got an error, just return isRunning false.
  // the redux store will reset all values to their default.
  if (error || stats.error) {
    console.warn('We got an error for Status: ', error || stats.error);
    return defaultDaemonSummaryStatus;
  }
  const statsResult = stats.result;
  const parsedSummaryStatus: DaemonSummaryStatus = defaultDaemonSummaryStatus;

  if (!statsResult || _.isEmpty(statsResult)) {
    console.warn('We got an empty statsResult');
    return parsedSummaryStatus;
  }

  parsedSummaryStatus.numPeersConnected = statsResult.numPeersConnected;
  // we're polling every 500ms, so our per-second rate is half of the
  // rate we tallied up in this sample
  const txRate = statsResult.txRate || 0;
  const rxRate = statsResult.rxRate || 0;
  parsedSummaryStatus.uploadUsage =
    (txRate * POLLING_STATUS_INTERVAL_MS) / 1000;
  parsedSummaryStatus.downloadUsage =
    (rxRate * POLLING_STATUS_INTERVAL_MS) / 1000;

  parsedSummaryStatus.isRunning = statsResult.running || false;
  parsedSummaryStatus.numRoutersKnown = statsResult.numRoutersKnown || 0;

  parsedSummaryStatus.lokiAddress = statsResult.lokiAddress || '';
  parsedSummaryStatus.uptime = statsResult.uptime || 0;
  parsedSummaryStatus.version = statsResult.version || '';

  const exitMap = statsResult.exitMap;
  if (exitMap) {
    // exitMap should be of length 1 only, but it's an object with keys an IP (not as string)
    // so easier to parse it like this
    for (const k in exitMap) {
      parsedSummaryStatus.exitNode = exitMap[k];
    }
  } else {
    parsedSummaryStatus.exitNode = undefined;
  }
  const authCodes = statsResult?.authCodes || undefined;

  if (authCodes) {
    for (const lokiExit in authCodes) {
      const auth = statsResult?.authCodes[lokiExit];
      parsedSummaryStatus.exitAuthCode = auth;
    }
  } else {
    parsedSummaryStatus.exitAuthCode = undefined;
  }

  parsedSummaryStatus.ratio = `${Math.ceil(statsResult?.ratio * 100 || 0)}%`;

  parsedSummaryStatus.numPathsBuilt = statsResult.numPathsBuilt;
  return parsedSummaryStatus;
};
