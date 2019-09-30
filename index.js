import { writable, readable, derived } from 'svelte/store';
import eth from './eth';
import { isPrivateWindow } from './web';
import { Wallet } from 'ethers';

// import Portis from '@portis/web3';
// import { Bitski, AuthenticationStatus } from 'bitski';
// import axios from 'axios';

const voidLog = {
    trace:() => {},
    debug:() => {},
    info:() => {},
    warn:() => {},
    error:() => {},
    fatal:() => {},
    silent:() => {},
};

function getWalletVendor(ethereum) {
    if (!ethereum) {
        return undefined;
    } else if(ethereum.isMetaMask) {
        return 'Metamask';
    } else if(navigator.userAgent.indexOf("Opera") != -1 || navigator.userAgent.indexOf("OPR/") != -1) {
        return 'Opera';
    } else {
        return 'unknown';
    }
}

const $wallet = {
    status: 'Loading',
    requestingTx: false,
};
window.$wallet = $wallet;
let metamaskFirstLoadIssue;
export default (log) => {
    if(!log) {
        log = voidLog;
    }

    let ethSetup;
    
    function reloadPage(reason, instant) {
        log.info((instant ? 'instant ' : '') + 'reloading page because ' + reason);
        if (instant) {
            window.location.reload();
        } else {
            setTimeout(() => window.location.reload(), 100);
        }
    }

    const { subscribe, set, update } = writable();
    let contracts = {};
    function _set(obj) {
        for (let key of Object.keys(obj)) {
            $wallet[key] = obj[key];
        }
        log.info('WALLET', JSON.stringify($wallet, null, '  '));
        set($wallet);
    }

    _set($wallet);

    function getEthereum() {
        if (window.ethereum) {
            return window.ethereum;
        } else if (window.web3) {
            return window.web3.currentProvider;
        }
        return null;
    }

    function fetchEthereum() {
        // TODO test with document.readyState !== 'complete' || document.readyState === 'interactive'
        return new Promise((resolve, reject) => {
            if(document.readyState !== 'complete') {
                document.onreadystatechange = function() {
                    if (document.readyState === 'complete') {
                        document.onreadystatechange = null;
                        resolve(getEthereum());    
                    }
                };
            } else {
                resolve(getEthereum());
            }
        });
    }

    function watch() {
        function checkAccounts(accounts) {
            if ($wallet.status === 'Locked' || $wallet.status === 'Unlocking') {
                return; // skip as Unlock / post-Unlocking will fetch the account
            }
            // log.info('checking ' + accounts);
            if (accounts && accounts.length > 0) {
                const account = accounts[0];
                if ($wallet.address) {
                    if (account.toLowerCase() !== $wallet.address.toLowerCase()) {
                        reloadPage('accountsChanged', true);
                    }
                } else {
                    // if($wallet.readOnly) {
                    //     ethSetup = eth._setup(ethereum);
                    // }
                    log.info('now READY');
                    _set({
                        address: account,
                        status: 'Ready',
                        readOnly: undefined,
                    });
                }
            } else {
                if ($wallet.address) {
                    // if($wallet.readOnly) {
                    //     ethSetup = eth._setup(ethereum);
                    // }
                    _set({
                        address: undefined,
                        status: 'Locked',
                        readOnly: undefined,
                    });
                }
            }
        }
        function checkChain(newChainId) {
            // log.info('checking new chain ' + newChainId);
            if ($wallet.chainId && newChainId != $wallet.chainId) {
                // log.info('from ' + $wallet.chainId + ' to ' + newChainId);
                reloadPage('networkChanged');
            }
        }
        async function watchAccounts() {
            if ($wallet.status === 'Locked' || $wallet.status === 'Unlocking') {
                return; // skip as Unlock / post-Unlocking will fetch the account
            }
            let accounts;
            try {
                // log.trace('watching accounts...');
                accounts = await eth.fetchAccounts();
                // log.trace(`accounts : ${accounts}`);
            } catch (e) {
                log.error('watch account error', e);
            }

            checkAccounts(accounts);
        }
        async function watchChain() {
            let newChainId;
            try {
                // log.trace('watching chainId...');
                newChainId = await eth.fetchBuiltinChainId();
                // log.trace(`newChainId : ${newChainId}`);
            } catch (e) {
                log.error('watch account error', e);
            }

            checkChain(newChainId);
        }
        if (window.ethereum) {
            try {
                window.ethereum.once('accountsChanged', checkAccounts);
                window.ethereum.once('networkChanged', checkChain);
                window.ethereum.once('chainChanged', checkChain);
            } catch (e) {
                log.info('no ethereum.once');
            }
        }

        // TODO move that into the catch block except for Metamask

        // still need to watch as even metamask do not emit the "accountsChanged" event all the time: TODO report bug
        setInterval(watchAccounts, 1000);

        // still need to watch chain for old wallets
        setInterval(watchChain, 2000);
        return window.ethereum;
    }

    async function retry() {
        if (_retry) {
            if(metamaskFirstLoadIssue) {
                reloadPage('metamask issue', true);
            } else {
                return _retry(true);    
            }
        } else {
            throw new Error('cannot retry');
        }
    }

    function fetchChainIdWithTimeout(eth, ms = 2000) {
        let timeout = new Promise((resolve, reject) => {
            let id = setTimeout(() => {
              clearTimeout(id);
              reject('Timed out in '+ ms + 'ms.')
            }, ms)
        });
        return Promise.race([
            eth.fetchChainId(),
            timeout
        ])
    }

    async function _load({ fallbackUrl, supportedChainIds, registerContracts, localKey, disableBuiltInWallet }, isRetry) {
        _set({ status: 'Loading', supportedChainIds });

        disableBuiltInWallet = disableBuiltInWallet || typeof localKey === 'string';
        let ethereum;
        if (!disableBuiltInWallet) {
            try {
                ethereum = await fetchEthereum();
            } catch(e) {
                log.error('error getting access to window.ethereum' , e);
            }
        }

        const vendor = getWalletVendor(ethereum);
        if (vendor) {
            _set({vendor});
        }

        let opera_enabled_before = false;
        const isOperaWallet = vendor === 'Opera';
        if (isOperaWallet) {
            opera_enabled_before = localStorage.getItem('opera_wallet_enabled');
            log.info('load', { opera_enabled_before });
        }

        let web3EnabledAndWorking = false;

        if (ethereum) {
            if (!opera_enabled_before && !isRetry && isOperaWallet) {
                _set({
                    status: 'Opera_Locked',
                });
                return $wallet;
            }
            ethSetup = eth._setup(ethereum);
            web3EnabledAndWorking = true;
            // log.info('web3 is there...');
            // log.info('checking chainId...');
            let chainId;
            try {
                log.trace('fetching chainId...');
                chainId = await fetchChainIdWithTimeout(eth);
                log.trace(`chainId : ${chainId}`);
            } catch (e) {
                if(typeof e === 'string' && e.startsWith('Timed out')) {
                    metamaskFirstLoadIssue = true;
                }
                log.error('builtin wallet : error fetching chainId', e);
                if(fallbackUrl) {
                    ethSetup = eth._setup(fallbackUrl, ethereum);
                }
                if (isOperaWallet) {
                    log.info('Opera web3 quircks');
                    // if (isRetry) {
                    //     _set({
                    //         status: 'Error',
                    //         error: {
                    //             code: 5031,
                    //             message: "Opera web3 implementation is non-standard, did you block our application or forgot to set up yoru wallet?",
                    //         },
                    //         readOnly: true
                    //     });
                    // } else {
                    _set({
                        status: 'Opera_FailedChainId',
                        readOnly: fallbackUrl ? true : undefined
                    });
                    // }
                } else {
                    _set({
                        status: 'Error',
                        error: {
                            code: 5030,
                            message: "could not detect current chain",
                        },
                        readOnly: fallbackUrl ? true : undefined
                    });
                }
                log.info('failed to get chain Id');
                return $wallet;
            }

            if (isOperaWallet && !opera_enabled_before) {
                localStorage.setItem('opera_wallet_enabled', true);
                log.info('opera enabled saved');
            }
            _set({ chainId });

            if (supportedChainIds && supportedChainIds.indexOf(chainId) == -1) {
                let readOnly
                if(fallbackUrl) {
                    ethSetup = eth._setup(fallbackUrl, ethereum);
                    const fallbackChainId = await eth.fetchChainId();
                    if (registerContracts) {
                        const contractsInfo = await registerContracts($wallet, fallbackChainId);
                        contracts = eth.setupContracts(contractsInfo);
                    }
                    readOnly = true;
                }
                _set({
                    chainNotSupported: true,
                    requireManualChainReload: isOperaWallet,
                    readOnly
                })
            } else {
                if (ethSetup && registerContracts) {
                    const contractsInfo = await registerContracts($wallet);
                    contracts = eth.setupContracts(contractsInfo);
                }
            }

            let accounts;
            try {
                log.trace('getting accounts..');
                accounts = await eth.fetchAccounts();
                log.trace(`accounts : ${accounts}`);
            } catch (e) {
                log.error('accounts', e);
                accounts = undefined;
            }
            if (accounts && accounts.length > 0) {
                log.info('already READY');
                _set({
                    address: accounts[0],
                    status: 'Ready'
                });
            } else {
                _set({ status: 'Locked' });
            }

            if (web3EnabledAndWorking) {
                watch();
            }
        } else {
            if(fallbackUrl) {
                let ethersWallet;
                let hasPrivateModeRisk
                if (localKey) {
                    hasPrivateModeRisk = await isPrivateWindow();
                    let privateKey;
                    if(typeof localKey === 'string') {
                        try {
                            privateKey = localStorage.getItem('__wallet_priv');
                        } catch(e) {

                        }
                        if(privateKey && privateKey !== '' && privateKey !== localKey) {
                            // if fallbaclOnLocalKey is different than existing key, back up the existing key
                            // TODO add a way to retrieve it
                            try {
                                let currentBackUp = [];
                                const currentBackUpString = localStorage.getItem('__wallet_priv_backup');
                                if (currentBackUpString && currentBackUpString !== '') {
                                    try {
                                        currentBackUp = JSON.parse(currentBackUpString);
                                    } catch(e) {
                                        currentBackUp = [];
                                    }
                                }
                                currentBackUp.push(privateKey);
                                localStorage.setItem('__wallet_priv_backup', JSON.stringify(currentBackUp));
                            } catch(e) {
                                console.error('failed to backup existing privateKey', e);
                            }
                            privateKey = localKey;
                            localStorage.setItem('__wallet_priv', privateKey);
                        }
                    } else {
                        try {
                            privateKey = localStorage.getItem('__wallet_priv');
                            // if(!privateKey || privateKey === '') {
                            //     privateKey = localStorage.getItem('__wallet_priv_backup');
                            // }
                        } catch (e) {
                            console.error('error while getting local key', e);
                        }
                    }
                    
                    if(!privateKey || privateKey === '') {
                        ethersWallet = Wallet.createRandom();
                        localStorage.setItem('__wallet_priv', ethersWallet.privateKey);
                    } else {
                        ethersWallet = new Wallet(privateKey);
                    }
                }
                ethSetup = eth._setup(fallbackUrl, null, ethersWallet ? ethersWallet.privateKey : undefined);
                let chainId;
                try {
                    log.trace('fetching chainId from fallback...');
                    chainId = await eth.fetchChainId();
                    log.trace(`chainId : ${chainId}`);
                } catch (e) {
                    log.error('fallback : error fetching chainId', e);
                }
                if (chainId) {
                    _set({chainId});
                    if (registerContracts) {
                        const contractsInfo = await registerContracts($wallet);
                        contracts = eth.setupContracts(contractsInfo);
                    }
                    if (ethersWallet) {
                        _set({
                            address: ethersWallet.address,
                            status: 'Ready',
                            isLocal: true,
                            hasPrivateModeRisk: hasPrivateModeRisk ? true : undefined,
                        });
                    } else {
                        _set({
                            status: 'NoWallet',
                            readOnly: true
                        });
                    }
                } else {
                    _set({
                        status: 'Error',
                        error: {
                            code: 5030,
                            message: "could not detect current chain", // could try again
                        },
                        readOnly: ethersWallet ? undefined : true,
                    });
                }
            } else {
                _set({
                    status: 'NoWallet',
                });
            }
        }
        return $wallet;
    }

    let promise;
    let _retry;
    async function load(config) {
        if (!process.browser) {
            _set({ status: 'Loading' });
            return $wallet;
        }
        if (promise) {
            return promise;
        }
        if(!config) {
            config = {};
        }
        _retry = (isRetry) => _load(config, isRetry);
        promise = _retry(false);
        return promise;
    }

    function call(options, contract, methodName, ...args) {
        // cal with from ?

        // const w = await ensureEnabled();
        // if (!w || !w.address) {
        //     throw new Error('Can\'t perform tx');
        // }
        if (typeof options === 'string') {
            if(typeof methodName !== 'undefined') {
                args.unshift(methodName);
            }
            methodName = contract;
            contract = options;
            options = undefined;
        }

        if (typeof args === 'undefined') {
            args = [];
        }

        if (contract) {
            const ethersContract = contracts[contract];
            const method = ethersContract.callStatic[methodName].bind(ethersContract);
            if(args.length > 0) {
                return method(...args, options || {}); // || defaultOptions);
            } else {
                return method(options || {}); // || defaultOptions);
            }
        } else {
            log.error('TODO send raw call');
        }
    }

    async function unlock() {
        log.info('Requesting unlock');
        _set({
            status: 'Unlocking'
        });
        let accounts;
        // try {
        //     accounts = await eth.fetchAccounts();
        // } catch (e) {
        //     log.info('cannot get accounts', e);
        //     accounts = [];
        // }
        // if (!accounts || accounts.length == 0) {
        // log.info('no accounts');
        try {
            log.trace('ethereum.enable...');
            accounts = await window.ethereum.enable();
            log.trace(`accounts : ${accounts}`);
        } catch (e) {
            log.info('refused to get accounts', e);
            // try {
            //     log.info('trying accounts...', e);
            //     accounts = await window.web3.eth.getAccounts();
            // } catch(e) {
            //     log.info('no accounts', e);
            accounts = [];
            // }
        }
        // }

        if (accounts.length > 0) {
            log.info('unlocked READY');
            _set({
                address: accounts[0],
                status: 'Ready'
            });
        } else {
            _set({
                status: 'Locked'
            });
            return false;
        }

        return true;
    }

    async function ensureEnabled() {
        if ($wallet.status === 'Locked') {
            await unlock();
        }
        return $wallet;
    }

    async function tx(options, contract, methodName, ...args) {
        const w = await ensureEnabled();
        if (!w || !w.address) {
            throw new Error('Can\'t perform tx'); // TODO more meaningful answer (user rejected?)
        }
        if (typeof options === 'string') {
            if(typeof methodName !== 'undefined') {
                args.unshift(methodName);
            }
            methodName = contract;
            contract = options;
            options = undefined;
        }

        options = options || {};
        if(options.gas) {
            options.gasLimit = options.gas;
            delete options.gas;
        }

        if (typeof args === 'undefined') {
            args = [];
        }

        if(options.from && options.from.toLowerCase() !== $wallet.address.toLowerCase()) {
            throw new Error('from != wallet.address')
        }
        delete options.from;

        let tx;
        if (contract) {
            const ethersContract = contracts[contract];
            const method = ethersContract[methodName].bind(ethersContract);
            
            if(!$wallet.isLocal) { // TODO add confirmation screens for burner wallet
                _set({
                    requestingTx: true,
                });
            }
            try {
                log.trace(`tx ${methodName}: ${args}`);
                const balance = await eth.getBalance($wallet.address);
                if (balance.eq(0)) { // TODO full balance check
                    throw new Error('not enough balance'); // TODO ensure error message passes through
                }
                tx = await method(...args, options); // || defaultOptions);
                log.trace(tx);
            } catch (e) {
                log.error('error making tx', e);
                tx = null; // TODO show error if not a user denial
            } finally {
                _set({
                    requestingTx: false,
                });
            }
            if(tx) {
                const pendingTx = {
                    hash: tx.hash,
                    contractName: contract,
                    methodName,
                    args,
                    options
                };
                emitTransaction(pendingTx, $wallet.chainId, $wallet.address);
            }
        } else {
            log.error('TODO send raw tx');
        }
        return tx;
    }

    function emitTransaction(tx, chainId, address) {
        for (let callback of transactionCallbacks) {
            callback(tx, chainId, address);
        }
    }

    const transactionCallbacks = [];
    function onTransactionBroadcasted(callback) {
        transactionCallbacks.push(callback);
    }

    return {
        load,
        retry,
        unlock,
        subscribe,
        onTransactionBroadcasted,
        tx,
        call,
        getProvider: () => ethSetup.provider,
        reloadPage: () => reloadPage('requested', true),
        getContract: (name) => {
            const ethersContract = contracts[name];
            if(ethersContract) {
                return {
                    abi: ethersContract.interface.fragments,
                    address: ethersContract.address,
                };
            }
        }
    };
};
