import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NbDialogService } from '@nebular/theme';
import { TranslateService } from '@ngx-translate/core';
import { Cell, LocalDataSource } from 'angular2-smart-table';
import { filter, tap } from 'rxjs/operators';
import { debounceTime, firstValueFrom, Subject } from 'rxjs';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import {
	InvitationTypeEnum,
	PermissionsEnum,
	IOrganization,
	IUserOrganizationCreateInput,
	RolesEnum,
	IUser,
	ComponentLayoutStyleEnum,
	IRolePermission,
	IUserViewModel,
	IUserOrganization,
	ITag,
	IEmployee
} from '@gauzy/contracts';
import {
	EmployeesService,
	ErrorHandlingService,
	Store,
	ToastrService,
	UsersOrganizationsService
} from '@gauzy/ui-core/core';
import { ComponentEnum, distinctUntilChange } from '@gauzy/ui-core/common';
import {
	DateFormatPipe,
	DeleteConfirmationComponent,
	EmailComponent,
	IPaginationBase,
	InviteMutationComponent,
	PaginationFilterBaseComponent,
	PictureNameTagsComponent,
	RoleComponent,
	TagsColorFilterComponent,
	TagsOnlyComponent,
	UserMutationComponent
} from '@gauzy/ui-core/shared';
import { EmployeeWorkStatusComponent } from '../employees/table-components';

@UntilDestroy({ checkProperties: true })
@Component({
    templateUrl: './users.component.html',
    styleUrls: ['./users.component.scss'],
    standalone: false
})
export class UsersComponent extends PaginationFilterBaseComponent implements OnInit, OnDestroy {
	public PermissionsEnum = PermissionsEnum;
	public users: IUser[] = [];
	public settingsSmartTable: object;
	public sourceSmartTable = new LocalDataSource();
	public selectedUser: IUserViewModel;
	public userName = 'User';
	public loading: boolean;
	public hasSuperAdminPermission: boolean = false;
	public organizationInvitesAllowed: boolean = false;
	public showAddCard: boolean;
	public disableButton = true;
	public viewComponentName: ComponentEnum;
	public dataLayoutStyle = ComponentLayoutStyleEnum.TABLE;
	public componentLayoutStyleEnum = ComponentLayoutStyleEnum;
	public organization: IOrganization;
	private _refresh$: Subject<any> = new Subject();

	constructor(
		private readonly dialogService: NbDialogService,
		private readonly store: Store,
		private readonly router: Router,
		private readonly toastrService: ToastrService,
		private readonly errorHandlingService: ErrorHandlingService,
		private readonly route: ActivatedRoute,
		public readonly translateService: TranslateService,
		private readonly userOrganizationsService: UsersOrganizationsService,
		private readonly employeesService: EmployeesService,
		private readonly _dateFormatPipe: DateFormatPipe
	) {
		super(translateService);
		this.setView();
	}

	ngOnInit() {
		this._loadSmartTableSettings();
		this._applyTranslationOnSmartTable();
		this.subject$
			.pipe(
				debounceTime(300),
				tap(() => this.getUsers()),
				tap(() => this.cancel()),
				untilDestroyed(this)
			)
			.subscribe();
		this.store.selectedOrganization$
			.pipe(
				filter((organization: IOrganization) => !!organization),
				distinctUntilChange(),
				tap((organization: IOrganization) => (this.organization = organization)),
				tap(({ invitesAllowed }: IOrganization) => (this.organizationInvitesAllowed = invitesAllowed)),
				tap(() => this._refresh$.next(true)),
				tap(() => this.subject$.next(true)),
				untilDestroyed(this)
			)
			.subscribe();
		this.store.userRolePermissions$
			.pipe(
				filter((permissions: IRolePermission[]) => permissions.length > 0),
				untilDestroyed(this)
			)
			.subscribe(() => {
				this.hasSuperAdminPermission = this.store.hasPermission(PermissionsEnum.SUPER_ADMIN_EDIT);
			});
		this.route.queryParamMap
			.pipe(
				filter((params) => !!params && params.get('openAddDialog') === 'true'),
				debounceTime(1000),
				tap(() => this.add()),
				untilDestroyed(this)
			)
			.subscribe();
		this.pagination$
			.pipe(
				debounceTime(300),
				distinctUntilChange(),
				tap(() => this.subject$.next(true)),
				untilDestroyed(this)
			)
			.subscribe();
		this._refresh$
			.pipe(
				filter(() => this._isGridLayout),
				tap(() => this.refreshPagination()),
				tap(() => (this.users = [])),
				untilDestroyed(this)
			)
			.subscribe();
	}

	/**
	 * Sets the view to the 'Users' component and updates the layout style.
	 * Subscribes to the layout changes and triggers necessary updates like pagination and data clearing.
	 */
	setView(): void {
		// Set the component view name
		this.viewComponentName = ComponentEnum.USERS;

		// Listen for layout changes related to the 'Users' component
		this.store
			.componentLayout$(this.viewComponentName)
			.pipe(
				// Avoid emitting if the layout style has not changed
				distinctUntilChange(),

				// Update the data layout style based on the emitted layout
				tap((componentLayout: ComponentLayoutStyleEnum) => (this.dataLayoutStyle = componentLayout)),

				// Refresh pagination settings whenever the layout changes
				tap(() => this.refreshPagination()),

				// Only proceed further if the current layout is grid-based
				filter(() => this._isGridLayout),

				// Clear the users array when switching to grid layout
				tap(() => (this.users = [])),

				// Trigger a refresh event for components relying on the subject$
				tap(() => this.subject$.next(true)),

				// Automatically clean up the subscription when the component is destroyed
				untilDestroyed(this)
			)
			.subscribe();
	}

	/**
	 * Determines if the current layout style is set to grid (cards grid).
	 * This getter provides a clean and concise way to check the layout type.
	 *
	 * @returns A boolean indicating whether the layout style is 'CARDS_GRID'.
	 */
	private get _isGridLayout(): boolean {
		return this.componentLayoutStyleEnum.CARDS_GRID === this.dataLayoutStyle;
	}

	/**
	 * Handles the selection of a user from the list.
	 * Updates the selected user, enables/disables the button,
	 * and checks specific conditions like user role and permissions.
	 *
	 * @param param0 - The selection event containing user data.
	 * @param param0.isSelected - Indicates if the user is selected.
	 * @param param0.data - The data object of the selected user.
	 */
	selectUser({ isSelected, data }: { isSelected: boolean; data: any }): void {
		// Toggle the button state and update the selected user
		this.disableButton = !isSelected;
		this.selectedUser = isSelected ? data : null;

		// Set the user's display name or default to 'User'
		this.userName = data?.fullName?.trim() || 'User';

		// Handle SUPER_ADMIN role-specific logic
		if (data?.role?.name === RolesEnum.SUPER_ADMIN) {
			this.disableButton = this.hasSuperAdminPermission;
			this.selectedUser = this.hasSuperAdminPermission ? this.selectedUser : null;
		}
	}

	/**
	 * Opens a dialog to add a new user and handles the response.
	 * If a user is added successfully, displays a success message and triggers updates for related components.
	 */
	async add(): Promise<void> {
		// Open the user mutation dialog
		const dialog = this.dialogService.open(UserMutationComponent);

		// Wait for the dialog to close and retrieve the data
		const data = await firstValueFrom(dialog.onClose);

		// Check if data exists and contains a user
		if (data && data.user) {
			// Construct the user's full name if first or last name is provided
			if (data.user.firstName || data.user.lastName) {
				this.userName = `${data.user.firstName || ''} ${data.user.lastName || ''}`.trim();
			}

			// Display a success message using ToastrService
			this.toastrService.success('NOTES.ORGANIZATIONS.ADD_NEW_USER_TO_ORGANIZATION', {
				username: this.userName,
				orgname: this.store.selectedOrganization.name
			});

			// Notify subscribers about the update
			this._refresh$.next(true);
			this.subject$.next(true);
		}
	}


	/**
	 * Adds or edits a user in the organization based on the input data.
	 * If the user is active, creates the user and triggers updates for related components.
	 *
	 * @param user - The user data to be added or edited.
	 */
	async addOrEditUser(user: IUserOrganizationCreateInput): Promise<void> {
		// Check if the user is active
		if (user.isActive) {
			// Create the user in the organization and wait for the operation to complete
			await firstValueFrom(this.userOrganizationsService.create(user));

			// Show a success message using ToastrService
			this.toastrService.success('NOTES.ORGANIZATIONS.ADD_NEW_USER_TO_ORGANIZATION', {
				username: this.userName.trim(),
				orgname: this.store.selectedOrganization.name
			});

			// Trigger updates for other components or subscribers
			this._refresh$.next(true);
			this.subject$.next(true);
		}
	}

	/**
	 * Opens a dialog for inviting a user.
	 * Uses the `InviteMutationComponent` with the context set to user invitation.
	 * Waits for the dialog to close before proceeding.
	 */
	async invite(): Promise<void> {
		// Open the invite dialog with the specified context
		const dialog = this.dialogService.open(InviteMutationComponent, {
			context: {
				invitationType: InvitationTypeEnum.USER
			}
		});

		// Wait for the dialog to close and handle any resulting actions (if needed)
		await firstValueFrom(dialog.onClose);
	}

	/**
	 * Navigates to the edit page for a selected user.
	 * If a user is passed as a parameter, it selects that user before navigation.
	 *
	 * @param selectedItem - The user object to edit (optional).
	 */
	edit(selectedItem?: IUser): void {
		// If a user is provided, select that user
		if (selectedItem) {
			this.selectUser({
				isSelected: true,
				data: selectedItem
			});
		}

		// Navigate to the edit page of the selected user
		if (this.selectedUser?.id) {
			this.router.navigate(['/pages/users/edit/' + this.selectedUser.id]);
		}
	}

	/**
	 * Navigates to the user invites management page.
	 */
	manageInvites(): void {
		this.router.navigate(['/pages/users/invites/']);
	}

	/**
	 * Opens a dialog for deleting a user.
	 * If a user is passed as a parameter, it selects that user before navigation.
	 *
	 * @param selectedItem
	 */
	async delete(selectedItem?: IUser) {
		if (selectedItem) {
			this.selectUser({
				isSelected: true,
				data: selectedItem
			});
		}
		this.dialogService
			.open(DeleteConfirmationComponent, {
				context: {
					recordType: this.selectedUser.fullName + ' ' + this.getTranslation('FORM.DELETE_CONFIRMATION.USER')
				}
			})
			.onClose.pipe(untilDestroyed(this))
			.subscribe(async (result) => {
				if (result) {
					try {
						const username = this.userName;

						await this.userOrganizationsService.setUserAsInactive(this.selectedUser.id);
						this.toastrService.success('NOTES.ORGANIZATIONS.DELETE_USER_FROM_ORGANIZATION', { username });

						this._refresh$.next(true);
						this.subject$.next(true);
					} catch (error) {
						this.toastrService.danger(error);
					}
				}
			});
	}

	/**
	 * Cancels the current operation and hides the add card form.
	 * Resets the `showAddCard` flag to `false`.
	 */
	cancel(): void {
		this.showAddCard = false;
	}

	/**
	 * Remove user from organization based on user organization ID.
	 *
	 * @param selectedOrganization The selected user organization to remove the user from.
	 */
	async removeUserFromOrganization(selectedOrganization: IUserViewModel) {
		const { userOrganizationId } = selectedOrganization;
		const fullName = selectedOrganization.fullName.trim() || selectedOrganization.email;

		/**
		 *  User belongs to only 1 organization -> delete user
		 *	User belongs multiple organizations -> remove user from Organization
		 */
		const count = await this.userOrganizationsService.getUserOrganizationCount(userOrganizationId);
		const confirmationMessage = count === 1 ? 'FORM.DELETE_CONFIRMATION.DELETE_USER' : 'FORM.DELETE_CONFIRMATION.REMOVE_USER';

		// Open a confirmation dialog for the hiring action.
		const dialogRef = this.dialogService.open(DeleteConfirmationComponent, {
			context: {
				recordType: `${fullName} ${this.getTranslation(confirmationMessage)}`
			}
		});

		// Open confirmation dialog for user action
		dialogRef.onClose
			.pipe(
				untilDestroyed(this) // Ensures the observable is properly managed to prevent memory leaks.
			)
			.subscribe(async (result) => {
				if (!result) return; // If the dialog is closed without confirmation, exit the function.

				try {
					// If user confirms deletion, proceed with removal from organization
					await this.userOrganizationsService.removeUserFromOrg(userOrganizationId);

					this.toastrService.success('USERS_PAGE.REMOVE_USER', { name: fullName });
				} catch (error) {
					console.error('Failed to remove user from organization:', error.message);
					// Handle errors during the removal process
					this.errorHandlingService.handleError(error);
				} finally {
					// Perform cleanup or refresh actions
					this._refresh$.next(true);
					this.subject$.next(true);
				}
			});
	}

	/**
	 * Fetches user organizations with necessary relations.
	 *
	 * @returns A promise that resolves to an array of IUserOrganization.
	 */
	private async _fetchUserOrganizations(): Promise<IUserOrganization[]> {
		// If organization is not available, return undefined
		if (!this.organization) {
			return;
		}

		// Destructure organization properties for readability
		const { id: organizationId, tenantId } = this.organization;

		// Fetch user organizations with required relations
		const userOrganizations = await this.userOrganizationsService.getAll(
			['user', 'user.role', 'user.tags'],
			{ organizationId, tenantId },
			true
		);

		// Filter out user organizations that are not active or don't have a user with a role
		return userOrganizations.items.filter((organization: IUserOrganization) => organization.user?.role);
	}

	/**
	 * Fetches users from user organizations, maps them to the required format, and loads them into the smart table.
	 */
	private async getUsers(): Promise<void> {
		this.loading = true;

		try {
			const organizations = await this._fetchUserOrganizations();

			// Mapping fetched organizations to required user format
			const users = organizations
				.filter(({ user }) => !!user)
				.map(({ id: userOrganizationId, user, isActive }) => ({
					id: user.id,
					fullName: user.name,
					email: user.email,
					tags: user.tags,
					imageUrl: user.imageUrl,
					role: user.role,
					isActive: isActive,
					userOrganizationId,
					...this.employeeMapper(user.employee)
				}));

			// Initialize Smart Table and load users
			this.loadUsersToSmartTable(users);
		} catch (error) {
			console.error('Error while getting organization users', error?.message);
			this.toastrService.danger(error);
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Loads users into the smart table with pagination and updates pagination.
	 *
	 * @param users The array of users to load into the smart table.
	 * @param activePage The active page for pagination.
	 * @param itemsPerPage The number of items per page for pagination.
	 */
	private loadUsersToSmartTable(users: any[]): void {
		const { activePage, itemsPerPage } = this.getPagination();

		this.sourceSmartTable.setPaging(activePage, itemsPerPage, false);
		this.sourceSmartTable.load(users);

		// Load Grid Data
		this._loadDataGridLayout();

		// Updates pagination
		this.updatePagination();
	}

	/**
	 * Updates pagination information based on the current state of the smart table.
	 */
	private updatePagination(): void {
		// Update pagination with total count of items in the smart table
		this.setPagination({
			...this.getPagination(),
			totalItems: this.sourceSmartTable.count()
		});
	}

	/**
	 * Loads unique user data into the users array if the grid layout is enabled.
	 */
	private async _loadDataGridLayout(): Promise<void> {
		// Check if grid layout is enabled
		if (!this._isGridLayout) {
			return; // Exit early if grid layout is disabled
		}

		// Retrieve elements from the source smart table
		const elements = await this.sourceSmartTable.getElements();

		// Filter unique users based on their IDs
		const uniqueUsers = elements.filter(
			(user: IUserOrganization, index: number, self: any) => index === self.findIndex(({ id }) => user.id === id)
		);

		// Add unique users to the users array
		this.users.push(...uniqueUsers);
	}

	/**
	 *
	 */
	private _loadSmartTableSettings() {
		const pagination: IPaginationBase = this.getPagination();
		this.settingsSmartTable = {
			actions: false,
			selectedRowIndex: -1,
			pager: {
				display: false,
				perPage: pagination ? pagination.itemsPerPage : 10
			},
			columns: {
				fullName: {
					title: this.getTranslation('SM_TABLE.FULL_NAME'),
					type: 'custom',
					class: 'align-row',
					renderComponent: PictureNameTagsComponent,
					componentInitFunction: (instance: PictureNameTagsComponent, cell: Cell) => {
						instance.rowData = cell.getRow().getData();
						instance.value = cell.getValue();
					}
				},
				email: {
					title: this.getTranslation('SM_TABLE.EMAIL'),
					type: 'custom',
					renderComponent: EmailComponent,
					componentInitFunction: (instance: EmailComponent, cell: Cell) => {
						instance.rowData = cell.getRow().getData();
					}
				},
				role: {
					title: this.getTranslation('SM_TABLE.ROLE'),
					type: 'custom',
					width: '5%',
					renderComponent: RoleComponent,
					componentInitFunction: (instance: RoleComponent, cell: Cell) => {
						instance.value = cell.getRawValue();
					}
				},
				tags: {
					title: this.getTranslation('SM_TABLE.TAGS'),
					type: 'custom',
					renderComponent: TagsOnlyComponent,
					componentInitFunction: (instance: TagsOnlyComponent, cell: Cell) => {
						instance.rowData = cell.getRow().getData();
						instance.value = cell.getValue();
					},
					filter: {
						type: 'custom',
						component: TagsColorFilterComponent
					},
					filterFunction: (tags: ITag[]) => {
						const tagIds = [];
						for (const tag of tags) {
							tagIds.push(tag.id);
						}
						this.setFilter({ field: 'tags', search: tagIds });
					},
					isSortable: false,
					class: 'align-row',
					width: '10%'
				},
				status: {
					title: this.getTranslation('SM_TABLE.STATUS'),
					type: 'custom',
					width: '5%',
					renderComponent: EmployeeWorkStatusComponent,
					componentInitFunction: (instance: EmployeeWorkStatusComponent, cell: Cell) => {
						instance.rowData = cell.getRow().getData();
					}
				}
			}
		};
	}

	/**
	 * Subscribes to language change events and reloads smart table settings accordingly.
	 */
	private _applyTranslationOnSmartTable(): void {
		this.translateService.onLangChange
			.pipe(
				tap(() => this._loadSmartTableSettings()),
				untilDestroyed(this)
			)
			.subscribe();
	}

	/*
	 * Clear selected item
	 */
	clearItem() {
		this.selectUser({
			isSelected: false,
			data: null
		});
	}

	/**
	 * Maps an employee object to a simplified format.
	 *
	 * @param employee The employee object to be mapped.
	 * @returns An object containing mapped employee properties.
	 */
	private employeeMapper(employee: IEmployee): any {
		if (!employee) {
			return {};
		}

		const { endWork, startedWorkOn, isTrackingEnabled, id } = employee;
		// "Range" when was hired and when exit
		const start = this._dateFormatPipe.transform(startedWorkOn, null, 'LL');
		const end = this._dateFormatPipe.transform(endWork, null, 'LL');

		const workStatus = [start, end].filter(Boolean).join(' - ');

		return {
			employeeId: id,
			endWork: endWork ? new Date(endWork) : null,
			workStatus: endWork ? workStatus : '',
			startedWorkOn,
			employee,
			isTrackingEnabled
		};
	}

	/**
	 * Checks if the user is an employee.
	 *
	 * @param user The user to check.
	 * @returns True if the user is an employee, otherwise false.
	 */
	private isEmployee(): boolean {
		return !!this.selectedUser.employeeId;
	}

	/**
	 * Converts a selected user to an employee on the users page.
	 *
	 * This method registers the selected user as an employee within the currently selected organization,
	 * provided the user hasn't already been registered as an employee.
	 *
	 * Preconditions:
	 * - A valid user must be selected.
	 * - The user must not already have an employee ID.
	 * - The organization details must be available.
	 *
	 * @throws {Error} Logs an error if the employee registration process fails.
	 *
	 * @returns {Promise<void>} Resolves when the user is successfully registered as an employee or does nothing if preconditions aren't met.
	 */
	async convertUserToEmployee(): Promise<void> {
		if (!this.selectedUser || !this.organization || this.isEmployee()) {
			return;
		}

		const { id: organizationId, tenantId } = this.organization;
		const { id: userId } = this.selectedUser;

		try {
			await firstValueFrom(
				this.employeesService.create({
					startedWorkOn: null, // Default start date is null (can be updated later)
					userId,
					organizationId,
					tenantId
				})
			);
			this.toastrService.success('USERS_PAGE.CONVERT_USER_TO_EMPLOYEE');
		} catch (error) {
			console.error('Error while converting user to employee:', error);
			this.toastrService.danger(error);
		}
	}

	// Method to toggle the 'showAddCard' state
	toggleAddCard(): void {
		this.showAddCard = !this.showAddCard;
	}

	ngOnDestroy() {}
}
