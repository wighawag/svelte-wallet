import eth from './eth';
import { isPrivateWindow } from './web';
import { Wallet } from 'ethers';

// TODO add timeout for settinpu Wallet // getting accounts, etc...
// TODO deal with error and error recovery
// error as notification, revert to previous state

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
    // TODO
}


const $wallet = {
    status: 'Loading',
    requestingTx: false, // TODO rename waitingTxConfirmation or add steps // number of block confirmation, etc...
};
if (typeof window !== 'undefined') {
    window.$wallet = $wallet;
}
export default (svelteStore, log) => {
    const { writable } = svelteStore
    if(!log) {
        log = voidLog;
    }

    let metamaskFirstLoadIssue;
    let _ethSetup;
    let _fallbackUrl;
    let _registerContracts;
    let _fetchInitialBalance;
    let _supportedChainIds;
    const _registeredWalletTypes = {};
    let _ethereum;
    
    function reloadPage(reason, instant) {
        if (typeof window !== 'undefined') {
            log.info((instant ? 'instant ' : '') + 'reloading page because ' + reason);
            if (instant) {
                window.location.reload();
            } else {
                setTimeout(() => window.location.reload(), 100);
            }
        } else {
            // TODO ?
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
        if (typeof window !== 'undefined') {
            if (window.ethereum) {
                return window.ethereum;
            } else if (window.web3) {
                return window.web3.currentProvider;
            }
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

    function watch(web3Provider) {
        async function checkAccounts(accounts) {
            if ($wallet.status === 'Locked' || $wallet.status === 'Unlocking') { // TODO SettingUpWallet ?
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
                    // if($wallet.readOnly) { // TODO check if it can reach there ?
                    //     _ethSetup = eth._setup(web3Provider);
                    // }
                    let initialBalance;
                    if(_fetchInitialBalance) {
                        initialBalance = await _ethSetup.provider.getBalance(account);
                    }
                    log.info('now READY');
                    _set({
                        address: account,
                        status: 'Ready',
                        readOnly: undefined,
                        initialBalance,
                    });
                }
            } else {
                if ($wallet.address) {
                    // if($wallet.readOnly) {  // TODO check if it can reach there ?
                    //     _ethSetup = eth._setup(web3Provider);
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
                log.info('from ' + $wallet.chainId + ' to ' + newChainId);
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

            await checkAccounts(accounts);
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

        if (web3Provider) { // TODO only if builtin is chosen // can use onNetworkChanged / onChainChanged / onAccountChanged events for specific web3 provuder setup
            try {
                web3Provider.once('accountsChanged', checkAccounts);
                web3Provider.once('networkChanged', checkChain);
                web3Provider.once('chainChanged', checkChain);
            } catch (e) {
                log.info('no web3Provider.once');
            }
        }

        // TODO move that into the catch block except for Metamask

        // still need to watch as even metamask do not emit the "accountsChanged" event all the time: TODO report bug
        setInterval(watchAccounts, 1000);

        // still need to watch chain for old wallets
        setInterval(watchChain, 2000);
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

    function withTimeout(ms, promise) {
        let timeoutPromise = new Promise((resolve, reject) => {
            let id = setTimeout(() => {
              clearTimeout(id);
              reject({message: 'Timed out in '+ ms + 'ms.', type: 'timeout'})
            }, ms)
        });
        return Promise.race([
            promise,
            timeoutPromise
        ])
    }

    function fetchChainIdWithTimeout(eth, ms = 2000) {
        let timeout = new Promise((resolve, reject) => { // TODO use `withTimeout(...)`
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

    async function _useBuiltinWallet(ethereum, unlock, isRetry) {
        if (!ethereum) {
            throw new Error('no ethereum provided');
        }
        let opera_enabled_before = false;
        const isOperaWallet = $wallet.vendor === 'Opera';
        if (isOperaWallet) {
            opera_enabled_before = localStorage.getItem('opera_wallet_enabled');
            if (!opera_enabled_before && !isRetry) {
                _set({
                    status: 'Opera_Locked', // TODO use Locked but mention it is not readable ?
                });
                return $wallet;
            }
        }
        
        _ethSetup = eth._setup(ethereum);
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
            if(_fallbackUrl) {
                _ethSetup = eth._setup(_fallbackUrl, ethereum);
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
                    status: 'Opera_FailedChainId', // TODO use Locked but mention it is not readable ?
                    readOnly: _fallbackUrl ? true : undefined
                });
                // }
            } else {
                _set({
                    status: 'Error',
                    error: {
                        code: 5030,
                        message: "could not detect current chain",
                    },
                    readOnly: _fallbackUrl ? true : undefined
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

        if (_supportedChainIds && _supportedChainIds.indexOf(chainId) == -1) {
            let readOnly
            if(_fallbackUrl) {
                _ethSetup = eth._setup(_fallbackUrl, ethereum);
                const fallbackChainId = await eth.fetchChainId();
                if (_registerContracts) {
                    try {
                        const contractsInfo = await _registerContracts($wallet, fallbackChainId);
                        contracts = eth.setupContracts(contractsInfo);
                    } catch (e) {
                        log.error(`failed to setup contracts for chain ${fallbackChainId} using ${_fallbackUrl}`, e);
                        _set({
                            status: 'Error',
                            error: {
                                code: 5030,
                                message: `no contract deployed on chain ${fallbackChainId}`, // could try again
                            },
                            readOnly: true,
                        });
                        return;
                    }
                    
                }
                readOnly = true;
            }
            _set({
                chainNotSupported: true,
                requireManualChainReload: isOperaWallet,
                readOnly
            })
        } else {
            if (_ethSetup && _registerContracts) {
                const contractsInfo = await _registerContracts($wallet);
                contracts = eth.setupContracts(contractsInfo);
            }
        }

        await _fetchAccountAndWatch(ethereum, unlock);
        return $wallet;
    }

    async function _fetchAccountAndWatch(provider, autoUnlock) {
        let accounts;
        try {
            log.trace('getting accounts..');
            accounts = await withTimeout(2000, eth.fetchAccounts());
            log.trace(`accounts : ${accounts}`);
        } catch (e) {
            // TODO timeout error
            if(e.type == 'timeout') {
                throw e;
            }
            log.error('accounts', e);
            accounts = undefined;
        }
        if (accounts && accounts.length > 0) {
            let initialBalance;
            if(_fetchInitialBalance) {
                initialBalance = await _ethSetup.provider.getBalance(accounts[0]);
            }
            log.info('already READY');
            _set({
                address: accounts[0],
                status: 'Ready',
                initialBalance,
            });
        } else {
            if(autoUnlock) {
                await unlock();
            } else {
                _set({ status: 'Locked' });
            }
        }

        if (provider) {
            watch(provider);
        }
    }

    async function _useOrCreateLocalWallet(localKey) {
        if(_fallbackUrl) {
            let ethersWallet;
            if (localKey) {
                log.trace('using localkey', localKey);
                if(typeof localKey === 'string') {
                    ethersWallet = new Wallet(localKey); // do not save it on local Storage
                    await setupLocalWallet(ethersWallet);
                } else { // assume it to be a boolean and create a wallet if not there
                    let privateKey
                    try {
                        privateKey = localStorage.getItem('__wallet_priv');
                    } catch(e) {}
                    if(privateKey && privateKey !== '') {
                        const ethersWallet = new Wallet(privateKey);
                        await setupLocalWallet(ethersWallet);
                    } else {
                        await createLocalWallet();
                    }
                }
            } else {
                // log.trace('ckecking localStorage key', localKey);
                let privateKey
                try {
                    privateKey = localStorage.getItem('__wallet_priv');
                } catch(e) {}
                let ethersWallet;
                if(privateKey && privateKey !== '') {
                    // log.trace('found key');
                    ethersWallet = new Wallet(privateKey);
                }
                await setupLocalWallet(ethersWallet, {createNew: false});
            }
        } else {
            throw new Error('need a fallbackUrl for local wallet'); // TODO pass it in local config ? or reuse ?
        }
        return $wallet;
    }

    async function use(walletTypeId, loadingTime) {
        if(!loadingTime) {
            _set({status: 'SettingUpWallet'});
        }
        log.trace('using walletType', walletTypeId);
        const walletType = _registeredWalletTypes[walletTypeId];
        if (!walletType) {
            throw new Error('wallet type ' + walletType + ' not  registered for use');
        }
        if(walletTypeId == 'builtin') {
            return _useBuiltinWallet(_ethereum, true); // TODO ethereum;
        } else if (walletTypeId == 'local') {
            return _useOrCreateLocalWallet(true); // TODO
        }
        let chainId;
        if(_fallbackUrl) {
            _ethSetup = eth._setup(_fallbackUrl);
            chainId = await eth.fetchChainId();
        }
        if (!chainId) {
            chainId = _supportedChainIds[0]; // TODO explicit chainId to use as defaukt ?
        }
        log.trace('setting up wallet module on chain ' + chainId);
        const result = await walletType.setup({chainId, fallbackUrl: _fallbackUrl});
        const {web3Provider, accounts} = result;
        _set({ chainId });
        log.trace('setting up web3 provider');
        // TODO record chainId //assume module us behaving correctly
        _ethSetup = eth._setup(web3Provider); // TODO check if eth._setup assume builtin behaviour ?
        log.trace('fetching accounts');
        if (!accounts) {
            // TODO
        }
        if (_ethSetup && _registerContracts) {
            const contractsInfo = await _registerContracts($wallet);
            contracts = eth.setupContracts(contractsInfo);
        }
        try {
            await _fetchAccountAndWatch(web3Provider);
        } catch(e) {
            _set({
                status: 'WalletToChoose',
                error: {type: 'timeout', message: 'cannot fetch account'}
            });
        }
        
    }

    // TODO autoConnectIfOnlyOneChoiceAvailable ? onlyOneChoice provdied as config ?
    async function _load({ fallbackUrl, autoConnectIfOnlyOneChoiceAvailable, reuseLastWallet, supportedChainIds, registerContracts, walletTypes, fetchInitialBalance}, isRetry) {
        _fallbackUrl = fallbackUrl;
        _registerContracts = registerContracts;
        _fetchInitialBalance = fetchInitialBalance;
        _supportedChainIds = supportedChainIds; // TODO clone ?
        _set({ status: 'Loading', _supportedChainIds });
        if (isRetry) { // this only concern builtin wallets // TODO rename ? or use `use('builtin')` instead of retry flow ?
            walletTypes = ['builtin'];
        }
        if(!walletTypes) {
            walletTypes = ['builtin'];
        } else if (typeof walletTypes == 'string') {
            walletTypes = [walletTypes];
        }
        const originalWalletTypes = [...walletTypes];
        for (const walletType of walletTypes) {
            if(typeof walletType == 'string') {
                _registeredWalletTypes[walletType] = walletType;
            } else {
                _registeredWalletTypes[walletType.id] = walletType;
            }
        }
        let lastWalletUsed;
        if (reuseLastWallet) {
            // TODO localStorage
        }
        if (lastWalletUsed && !_registeredWalletTypes[lastWalletUsed]) { // allow recover even if configuration change
            if(lastWalletUsed == 'builtin' || lastWalletUsed == 'local') {
                walletTypes.push(lastWalletUsed);
                _registeredWalletTypes[lastWalletUsed] = lastWalletUsed;
            } else {
                console.error('cannot reuse wallet type', lastWalletUsed);
                 // TODO error
            }
        }
              
        try {
            _ethereum = await fetchEthereum();
        } catch(e) {
            log.error('error getting access to window.ethereum' , e);
            // TODO error or not ? // TODO potentialError vs criticalError
        }
        const builtinWalletPresent = Boolean(_ethereum);
        const vendor = getWalletVendor(_ethereum);

        if (!builtinWalletPresent) {
            const indexOfBuiltin = walletTypes.indexOf('builtin');
            if (indexOfBuiltin != -1) {
                walletTypes.splice(indexOfBuiltin, 1);
            }
        }

        const walletChoice = [];
        for (const walletType of walletTypes) {
            if(typeof walletType == 'string') {
                walletChoice.push(walletType);
            } else {
                walletChoice.push(walletType.id);
            }
        }

        _set({
            vendor,
            builtinWalletPresent,
            walletChoice
        });
        
        let walletTypeToUse;
        if(lastWalletUsed) {
            walletTypeToUse = lastWalletUsed;
            if(lastWalletUsed == 'builtin') {
                if(!builtinWalletPresent) {
                    console.error('no builtin wallet present anymore');
                    walletTypeToUse = undefined; // TODO error
                }
            }
        }
        if (originalWalletTypes.length == 1 || (autoConnectIfOnlyOneChoiceAvailable && walletTypes.length == 1)) {
            walletTypeToUse = walletTypes[0].id || walletTypes[0];
        }
        if (walletTypeToUse) {
            if(walletTypeToUse == 'builtin') {
                if(builtinWalletPresent) {
                    return _useBuiltinWallet(_ethereum, false, isRetry);
                } else {
                    if(_fallbackUrl) {
                        await setupLocalWallet(undefined, {createNew: false}); // TODO rename
                    } else {
                        _set({
                            status: 'NoWallet',
                        });
                    }
                }
            } else if (walletTypeToUse == 'local') {
                return _useOrCreateLocalWallet(_registeredWalletTypes['local'].localKey || true);
            } else {
                use(walletTypeToUse, true);
            }
        } else {
            _set({
                status: 'WalletToChoose',
            });
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
            accounts = await _ethSetup.web3Provider.enable();
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
            let initialBalance;
            if(_fetchInitialBalance) {
                initialBalance = await _ethSetup.provider.getBalance(accounts[0]);
            }
            log.info('unlocked READY');
            _set({
                address: accounts[0],
                status: 'Ready',
                initialBalance,
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
        if ($wallet.status === 'Locked') { // TODO check race condition 'Unlocking' // queue tx requests ?
            await unlock();
        }
        return $wallet;
    }
    
    async function setupLocalWallet(ethersWallet, resetZeroWallet) {
        log.trace('setting up local wallet...', ethersWallet);
        _ethSetup = eth._setup(_fallbackUrl, null, ethersWallet ? ethersWallet.privateKey : undefined);
        
        // if(ethersWallet && resetZeroWallet) { // TODO if dev
        //     const balance = await _ethSetup.provider.getBalance(ethersWallet.address);
        //     const nonce = await _ethSetup.provider.getTransactionCount(ethersWallet.address);
        //     if(balance.eq(0) && nonce === 0) {
        //         log.trace('zero wallet detected, reseting...');
        //         localStorage.removeItem('__wallet_priv');
        //         if(resetZeroWallet.createNew) {
        //             log.trace('creating a new wallet');
        //             await createLocalWallet()
        //             return;
        //         } else {
        //             log.trace('deleting wallet');
        //             ethersWallet = undefined;
        //         }
        //     }
        // }
         
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
            if (_registerContracts) {
                try {
                    const contractsInfo = await _registerContracts($wallet);
                    contracts = eth.setupContracts(contractsInfo);
                } catch (e) {
                    log.error(`failed to setup contracts for chain ${chainId} using ${_fallbackUrl}`, e);
                    _set({
                        status: 'Error',
                        error: {
                            code: 5030,
                            message: `no contract deployed on chain ${chainId}`, // could try again
                        },
                        readOnly: true,
                    });
                    return;
                }
            }
            if (ethersWallet) {
                const hasPrivateModeRisk = await isPrivateWindow();
                let initialBalance;
                if(_fetchInitialBalance) {
                    initialBalance = await _ethSetup.provider.getBalance(ethersWallet.address);
                }
                _set({
                    address: ethersWallet.address,
                    status: 'Ready',
                    isLocal: true,
                    hasPrivateModeRisk: hasPrivateModeRisk ? true : undefined,
                    initialBalance,
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
    }

    async function createLocalWallet() {
        _set({status: 'CreatingLocalWallet'});
        log.trace('creating new wallet...');
        // TODO test over builtInWallet ?
        let privateKey
        try {
            privateKey = localStorage.getItem('__wallet_priv');
        } catch(e) {}
        if(privateKey && privateKey !== '') {
            throw new Error('cannot override existing local wallet');
        }
        const ethersWallet = Wallet.createRandom();
        try {
            localStorage.setItem('__wallet_priv', ethersWallet.privateKey);
        } catch(e) {
            throw new Error('cannot save local wallet');
        }
        await setupLocalWallet(ethersWallet);
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
        createLocalWallet,
        use,
        getProvider: () => _ethSetup.provider,
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
