import {
	ChangeDetectionStrategy,
	ChangeDetectorRef,
	Component,
	ElementRef,
	Inject,
	OnInit,
	ViewChild,
	OnDestroy
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IProxyConfig } from '@gauzy/contracts';
import { NbDialogService } from '@nebular/theme';
import { TranslateService } from '@ngx-translate/core';
import { AlertComponent } from '../../lib/dialogs/alert/alert.component';
import { GAUZY_ENV } from '../constants';
import { ElectronService, LoggerService } from '../electron/services';
import { LanguageElectronService } from '../language/language-electron.service';
import { LanguageSelectorComponent } from '../language/language-selector.component';
import { ErrorHandlerService, Store, ToastrNotificationService } from '../services';
import { SetupService } from './setup.service';

@Component({
    selector: 'ngx-setup',
    templateUrl: './setup.component.html',
    styleUrls: ['./setup.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class SetupComponent implements OnInit, OnDestroy {
	@ViewChild('dialogOpenBtn') btnDialogOpen: ElementRef<HTMLElement>;
	@ViewChild('selector') languageSelector: LanguageSelectorComponent;
	@ViewChild('logBox') logBox: ElementRef;
	public isSaving = false;
	public isCheckConnection = false;
	public logContents: string[] = [];
	constructor(
		private setupService: SetupService,
		private _cdr: ChangeDetectorRef,
		private dialogService: NbDialogService,
		private electronService: ElectronService,
		private _errorHandlerService: ErrorHandlerService,
		private _loggerServer: LoggerService,
		private _translateService: TranslateService,
		private _store: Store,
		@Inject(GAUZY_ENV)
		private readonly _environment: any,
		private readonly _domSanitizer: DomSanitizer,
		private languageElectronService: LanguageElectronService,
		private readonly _notifier: ToastrNotificationService
	) {
		electronService.ipcRenderer.on('setup-data', (_, arg) => {
			this.desktopFeatures.gauzyPlatform = arg.gauzyWindow;
			this.desktopFeatures.timeTracking = arg.timeTrackerWindow;
			this.connectivity.integrated = arg.isLocalServer;
			this.connectivity.custom = !arg.isLocalServer && arg.serverUrl !== 'https://api.gauzy.co';
			this.connectivity.live = arg.serverUrl && arg.serverUrl === 'https://api.gauzy.co';
			this.thirdParty.activityWatch = arg.aw;
			this.databaseDriver.sqlite = arg.db === 'sqlite';
			this.databaseDriver.postgre = arg.db === 'postgres';
			this.serverConfig.integrated.port = arg.port;
			if (!arg.isLocalServer) {
				this.serverConfig.custom.apiHost = arg.serverUrl.split(':')[1].slice(2);
				this.serverConfig.custom.port = arg.serverUrl.split(':')[2];
			}
			if (arg.db === 'postgres') {
				this.databaseConfig.postgre = {
					host: arg[arg.db]?.dbHost,
					dbPort: arg[arg.db]?.dbPort,
					dbName: arg[arg.db]?.dbName,
					dbUser: arg[arg.db]?.dbUsername,
					dbPassword: arg[arg.db]?.dbPassword
				};
			}
		});

		electronService.ipcRenderer.on('log_state', (_, arg) => {
			const validMessage = this.defaultMessage.findIndex((item) => arg.msg.indexOf(item) > -1);
			if (validMessage > -1) {
				if (validMessage === 0 && arg.msg.indexOf('Found 0 users in DB') < 0) {
					this.progressSetup = 100;
					this.progressMessage = arg.msg;
				} else {
					if (arg.msg.indexOf('SEEDED PRODUCTION DATABASE') > -1) {
						const leftProgress = 100 - this.progressSetup;
						this.progressSetup += leftProgress;
					} else {
						this.progressSetup += 3;
					}
					this.progressMessage = arg.msg;
				}
			}
			if (this.logContents.length < 20) {
				this.logContents.push(arg.msg);
			} else {
				this.logContents.shift();
				this.logContents.push(arg.msg);
			}
			this.scrollToBottom();
			this._cdr.detectChanges();
		});

		electronService.ipcRenderer.send('reset_permissions');

		this.gauzyIcon = this._domSanitizer.bypassSecurityTrustResourceUrl(this._environment.PLATFORM_LOGO);
		this.handleIpcEvent = this.handleIpcEvent.bind(this);
	}
	appName: string = this.electronService.remote.app.getName();
	loading: Boolean = false;
	iconAw = './assets/icons/toggle-left.svg';
	statusIcon = 'success';
	awCheck = false;
	awAPI: String = 'http://localhost:5600';
	buttonSave = false;
	gauzyIcon: SafeResourceUrl =
		this.isDesktopTimer || this.isServer
			? './assets/images/logos/logo_Gauzy.svg'
			: '../assets/images/logos/logo_Gauzy.svg';
	desktopFeatures: any = {
		gauzyPlatform: !this.isDesktopTimer,
		timeTracking: !this.isServer
	};

	connectivity: any = {
		integrated: this.isServer,
		custom: false,
		live: !this.isServer
	};

	thirdParty: any = {
		activitywatch: true,
		wakatime: true
	};

	databaseDriver: any = {
		sqlite: true,
		postgre: false
	};

	serverConfig: any = {
		integrated: {
			port: '3000',
			portUi: '4200',
			host: '0.0.0.0'
		},
		custom: {
			apiHost: '127.0.0.1',
			port: '3000'
		},
		live: {
			url: 'https://api.gauzy.co'
		}
	};

	databaseConfig: any = {
		postgre: {
			host: 'localhost',
			dbPort: '5432',
			dbName: 'postgres',
			dbUser: 'postgres',
			dbPassword: ''
		}
	};

	proxyOptions: IProxyConfig = {
		ssl: {
			key: '',
			cert: ''
		},
		secure: true,
		enable: false
	};

	showPassword = false;

	progressSetup = 0;
	progressMessage = 'Waiting ...';
	onProgress = false;

	defaultMessage: any = [
		'users in DB',
		'Found 0 users in DB',
		'CLEANING UP FROM PREVIOUS RUNS...',
		'CLEANED UP',
		'RESET DATABASE SUCCESSFUL',
		'SEEDING PRODUCTION DATABASE...',
		'SEEDING Changelog',
		'SEEDING Countries',
		'SEEDING Currencies',
		'SEEDING Languages',
		'SEEDING PRODUCTION REPORTS DATABASE...',
		'SEEDING Default Report Category & Report',
		'CLEANING UP REPORT IMAGES...',
		'CLEANED UP REPORT IMAGES',
		'SEEDED PRODUCTION REPORTS DATABASE',
		'Database Reports Seed completed',
		'SEEDING Default Email Templates',
		'SEEDING Skills',
		'SEEDING Contacts',
		'SEEDING Default Employee Invite',
		'SEEDING Default General Goal Setting',
		'SEEDING Default Goal Template',
		'SEEDING Default Goal KPI Template',
		'SEEDING Default Key Result Template',
		'SEEDING Default Time Off Policy',
		'SEEDING Default Integration Types',
		'SEEDING Default Integrations',
		'SEEDED PRODUCTION DATABASE'
	];

	dialogData: any = {
		title: 'TOASTR.TITLE.SUCCESS',
		message: '',
		status: 'success'
	};

	runApp = false;
	welcomeTitle = 'TIMER_TRACKER.SETUP.TITLE';
	welcomeLabel = 'TIMER_TRACKER.SETUP.LABEL';

	welcomeText() {
		switch (this.appName) {
			case this._environment.DESKTOP_SERVER_APP_NAME:
				this.welcomeTitle = 'TIMER_TRACKER.SETUP.TITLE_SERVER';
				this.welcomeLabel = 'TIMER_TRACKER.SETUP.LABEL_SERVER';
				break;
			case this._environment.DESKTOP_API_SERVER_APP_NAME:
				this.welcomeTitle = 'TIMER_TRACKER.SETUP.TITLE_SERVER_API';
				this.welcomeLabel = 'TIMER_TRACKER.SETUP.LABEL_SERVER_API';
				break;
			default:
				break;
		}
	}

	connectivityChange(event, key) {
		Object.keys(this.connectivity).forEach((itemKey) => {
			if (itemKey === key) {
				this.connectivity[key] = true;
			} else this.connectivity[itemKey] = false;
		});
	}

	databaseDriverChange(event, key) {
		Object.keys(this.databaseDriver).forEach((itemKey) => {
			if (itemKey === key) this.databaseDriver[key] = true;
			else this.databaseDriver[itemKey] = false;
		});
		this.validation();
	}

	getThirdPartyConfig() {
		return {
			aw: this.thirdParty.activitywatch,
			awHost: this.awAPI,
			wakatime: this.thirdParty.wakatime
		};
	}

	/**
	 * Sanitizes and constructs the server URL with the provided host and port.
	 *
	 * @param host - The host URL (e.g., "http://localhost").
	 * @param port - The port to append to the host URL (e.g., "3000").
	 * @returns The sanitized server URL as a string (e.g., "http://localhost:3000").
	 * @throws Error if the `host` parameter is missing or invalid.
	 */
	sanitizeServerPort(host: string, port: string): string {
		if (!host) {
			throw new Error('Host is required');
		}

		try {
			const url = new URL(host);
			if (port) {
				url.port = port; // Set the port if provided
			}
			return url.origin; // Return the sanitized origin
		} catch (error) {
			throw new Error('Invalid server URL format');
		}
	}

	getServerConfig() {
		if (this.connectivity.integrated) {
			return {
				...this.serverConfig.integrated,
				isLocalServer: true
			};
		}

		if (this.connectivity.custom) {
			const protocol = this.serverConfig.custom.apiHost.indexOf('http') === 0 ? '' : 'https://';
			const port = this.serverConfig.custom.port;
			const apiHost = `${protocol}${this.serverConfig.custom.apiHost}`;
			return {
				serverUrl: this.sanitizeServerPort(apiHost, port),
				isLocalServer: false
			};
		}

		this._loggerServer.log.info(`Server Config:`, this.serverConfig);
		if (this.connectivity.live) {
			return {
				serverUrl: this.serverConfig.live.url,
				isLocalServer: false
			};
		}
	}

	getDataBaseConfig() {
		if (this.databaseDriver.postgre) {
			return {
				postgres: {
					dbHost: this.databaseConfig.postgre.host,
					dbPort: this.databaseConfig.postgre.dbPort,
					dbName: this.databaseConfig.postgre.dbName,
					dbUsername: this.databaseConfig.postgre.dbUser,
					dbPassword: this.databaseConfig.postgre.dbPassword
				},
				db: 'postgres'
			};
		}

		if (this.databaseDriver.sqlite) {
			return {
				db: 'better-sqlite'
			};
		}

		return {};
	}

	getFeature() {
		return {
			gauzyWindow: this.desktopFeatures.gauzyPlatform,
			timeTrackerWindow: this.desktopFeatures.timeTracking
		};
	}

	public async saveAndRun() {
		if (this.connectivity.integrated) {
			this.onProgress = true;
		}
		const gauzyConfig = {
			...this.getServerConfig(),
			...this.getDataBaseConfig(),
			...this.getThirdPartyConfig(),
			...this.getFeature()
		};
		await this.electronService.ipcRenderer.invoke('PREFERRED_LANGUAGE', this.languageSelector.preferredLanguage);

		try {
			let isStarted = false;
			if (this.isServer) {
				this.electronService.ipcRenderer.send('start_server', gauzyConfig);
				isStarted = true;
			} else {
				isStarted = await this.electronService.ipcRenderer.invoke('START_SERVER', gauzyConfig);
			}
			if (isStarted && !gauzyConfig.isLocalServer) {
				this.electronService.ipcRenderer.send('app_is_init');
			}
		} catch (error) {
			this._errorHandlerService.handleError(error);
		}
		this.isSaving = false;
	}

	saveChange() {
		this.isSaving = true;
		this.runApp = true;
		this.checkConnection(true);
	}

	async pingAw(): Promise<void> {
		try {
			this.awCheck = false;
			await this.setupService.pingAw(`${this.awAPI}/api`);
			this.iconAw = './assets/icons/toggle-right.svg';
			this.awCheck = true;
			this.statusIcon = 'success';
			this._cdr.detectChanges();
		} catch (error) {
			this.iconAw = './assets/icons/toggle-left.svg';
			this.awCheck = true;
			this.statusIcon = 'danger';
			this._cdr.detectChanges();
		}
	}

	validation() {
		const { integrated, custom, live } = this.connectivity;
		const { port, portUi } = this.serverConfig.integrated;
		const { apiHost } = this.serverConfig.custom;
		const { host, dbPort, dbName, dbUser, dbPassword } = this.databaseConfig.postgre;

		const { postgre, sqlite } = this.databaseDriver;

		switch (true) {
			case integrated && port && portUi && dbPort && host && dbName && dbUser && dbPassword && postgre:
				this.buttonSave = true;
				break;
			case integrated && port && portUi && sqlite:
				this.buttonSave = true;
				break;
			case custom && apiHost && this.serverConfig.custom.port > 0:
				this.buttonSave = true;
				break;
			case live:
				this.buttonSave = true;
				break;
			case custom && apiHost && this.serverConfig.custom.port === null:
				this.buttonSave = true;
				break;
			default:
				this.buttonSave = false;
				break;
		}
	}

	openLink(link) {
		this.electronService.ipcRenderer.send('open_browser', {
			url: link
		});
	}

	getInputType() {
		if (this.showPassword) {
			return 'text';
		}
		return 'password';
	}

	toggleShowPassword() {
		this.showPassword = !this.showPassword;
	}

	checkDatabaseConn() {
		this.electronService.ipcRenderer.send('check_database_connection', {
			...this.getDataBaseConfig()
		});
	}

	async serverProtocolCheck(host, retry = false) {
		const url = new URL(host);
		try {
			const resp = await this.setupService.pingServer({
				host: url.origin
			})
			this.serverConfig.custom.apiHost = `${url.protocol}//${url.hostname}`;
			this.serverConfig.custom.port = url.port;
			return resp;
		} catch (error) {
			if (!retry) {
				url.protocol = url.protocol === 'http:' ? 'https' : 'http';
				return this.serverProtocolCheck(url.origin, true);
			}
			throw new Error(this._translateService.instant('TIMER_TRACKER.SETUP.UNABLE_TO_CONNECT'));
		}
	}

	async checkServerConn() {
		const serverHostOptions = this.getServerConfig();
		this.serverProtocolCheck(serverHostOptions.serverUrl)
			.then(async (res) => {
				if (this.runApp) {
					await this.saveAndRun();
				} else {
					this._notifier.success(this._translateService.instant('TIMER_TRACKER.SETTINGS.MESSAGES.CONNECTION_SUCCEEDS', {
						url: serverHostOptions.serverUrl
					}))
					this.isCheckConnection = false;
					this._cdr.detectChanges();
				}
			})
			.catch((e) => {
				this._notifier.error(e.message);
				this.isSaving = false;
				this.isCheckConnection = false;
				this._cdr.detectChanges();
			});
	}

	checkConnection(notRun = false) {
		this.runApp = notRun;
		if (!notRun) {
			this.isCheckConnection = true;
		}
		if (this.connectivity.integrated) {
			this.checkDatabaseConn();
		} else {
			this.checkServerConn();
		}
	}

	open(hasBackdrop: boolean) {
		this.dialogService.open(AlertComponent, {
			context: {
				data: this.dialogData
			}
		});
	}

	openfromhere(hasBackdrop: boolean) {
		this.open(hasBackdrop);
	}

	handleIpcEvent(_: any, arg: { type: string, data: any }) {
		if (arg.type === 'database_status') {
			if (arg.data.status) {
				this._notifier.success(arg.data.message);
			} else {
				this._notifier.warn(arg.data.message)
			}

			if (arg.data.status && this.runApp) {
				this.saveAndRun();
			} else {
				const elBtn: HTMLElement = this.btnDialogOpen.nativeElement;
				elBtn.click();
			}
			this.isSaving = false;
			this.isCheckConnection = false;
			this._cdr.detectChanges();
		}
	}

	ngOnInit(): void {
		this.languageElectronService.initialize<void>();
		this.welcomeText();
		this.electronService.ipcRenderer.on('setting_page_ipc', this.handleIpcEvent);
		this.validation();
	}

	ngOnDestroy(): void {
	    this.electronService.ipcRenderer.removeListener('setting_page_ipc', this.handleIpcEvent);
	}

	public get isDesktopTimer(): boolean {
		return this._environment.IS_DESKTOP_TIMER;
	}

	public get isDesktop(): boolean {
		return this._environment.IS_DESKTOP;
	}

	public get isServer(): boolean {
		return this._environment.IS_SERVER;
	}

	public get isServerApi(): boolean {
		return this._environment.IS_SERVER_API;
	}

	public get isAgent(): boolean {
		return this._environment.IS_AGENT;
	}

	private scrollToBottom() {
		this.logBox.nativeElement.scrollTop = this.logBox.nativeElement.scrollHeight;
	}

	public onChangeProxyConfig(config: IProxyConfig) {
		this.electronService.ipcRenderer.send('update_server_config', {
			secureProxy: config
		});
	}
}
